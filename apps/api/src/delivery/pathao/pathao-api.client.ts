import { Injectable } from "@nestjs/common";
import type { PathaoConfiguration } from "./pathao-config.js";

const PATHAO_REQUEST_TIMEOUT_MS = 8_000;
const MAX_RESPONSE_BYTES = 64 * 1024;

export type PathaoTokenResponse = {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
};

export type PathaoBookingRequest = {
  store_id: number;
  merchant_order_id: string;
  recipient_name: string;
  recipient_phone: string;
  recipient_address: string;
  delivery_type: 12 | 48;
  item_type: 2;
  item_quantity: number;
  item_weight: number;
  amount_to_collect: number;
};

export type PathaoBookingResponse = {
  consignmentId: string;
  merchantOrderId: string | null;
  orderStatus: string | null;
  deliveryFeeBdt: number | null;
};

export type PathaoOrderInfo = {
  consignmentId: string;
  merchantOrderId: string | null;
  orderStatus: string | null;
  updatedAt: string | null;
  invoiceId: string | null;
};

export type PathaoStoreRecord = {
  storeId: number;
  storeName: string;
  active: boolean;
};

export class PathaoRequestError extends Error {
  constructor(
    readonly code: string,
    readonly httpStatus: number | null = null,
  ) {
    super("The Pathao request could not be completed.");
    this.name = "PathaoRequestError";
  }
}

@Injectable()
export class PathaoApiClient {
  async issueToken(
    config: PathaoConfiguration,
    grant:
      { type: "password" } | { type: "refresh_token"; refreshToken: string },
  ): Promise<PathaoTokenResponse> {
    const request =
      grant.type === "password"
        ? {
            client_id: config.clientId,
            client_secret: config.clientSecret,
            grant_type: "password",
            username: config.username,
            password: config.password,
          }
        : {
            client_id: config.clientId,
            client_secret: config.clientSecret,
            grant_type: "refresh_token",
            refresh_token: grant.refreshToken,
          };
    const data = await this.request(config, "/aladdin/api/v1/issue-token", {
      method: "POST",
      body: request,
    });
    if (
      !isObject(data) ||
      data.token_type !== "Bearer" ||
      typeof data.access_token !== "string" ||
      typeof data.refresh_token !== "string" ||
      !Number.isSafeInteger(data.expires_in) ||
      Number(data.expires_in) < 1
    ) {
      throw new PathaoRequestError("PATHAO_TOKEN_RESPONSE_INVALID");
    }
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresInSeconds: Number(data.expires_in),
    };
  }

  async listStores(
    config: PathaoConfiguration,
    accessToken: string,
  ): Promise<PathaoStoreRecord[]> {
    const records: PathaoStoreRecord[] = [];
    let page = 1;
    let lastPage = 1;
    do {
      const suffix = page === 1 ? "" : `?page=${page}`;
      const response = await this.request(
        config,
        `/aladdin/api/v1/stores${suffix}`,
        { accessToken },
      );
      if (!isObject(response) || !isObject(response.data)) {
        throw new PathaoRequestError("PATHAO_STORES_RESPONSE_INVALID");
      }
      const data = response.data;
      if (!Array.isArray(data.data)) {
        throw new PathaoRequestError("PATHAO_STORES_RESPONSE_INVALID");
      }
      for (const value of data.data) {
        if (
          !isObject(value) ||
          !Number.isSafeInteger(value.store_id) ||
          typeof value.store_name !== "string" ||
          (value.is_active !== 0 && value.is_active !== 1)
        ) {
          throw new PathaoRequestError("PATHAO_STORES_RESPONSE_INVALID");
        }
        records.push({
          storeId: Number(value.store_id),
          storeName: value.store_name,
          active: value.is_active === 1,
        });
      }
      const candidateLastPage = data.last_page;
      if (candidateLastPage !== undefined) {
        if (
          !Number.isSafeInteger(candidateLastPage) ||
          Number(candidateLastPage) < page
        ) {
          throw new PathaoRequestError("PATHAO_STORES_RESPONSE_INVALID");
        }
        lastPage = Number(candidateLastPage);
      }
      if (records.length > 1000 || lastPage > 100) {
        throw new PathaoRequestError("PATHAO_STORES_RESPONSE_TOO_LARGE");
      }
      page += 1;
    } while (page <= lastPage);
    return records;
  }

  async createOrder(
    config: PathaoConfiguration,
    accessToken: string,
    body: PathaoBookingRequest,
  ): Promise<PathaoBookingResponse> {
    const response = await this.request(config, "/aladdin/api/v1/orders", {
      method: "POST",
      accessToken,
      body,
    });
    if (!isObject(response) || !isObject(response.data)) {
      throw new PathaoRequestError("PATHAO_BOOKING_RESPONSE_INVALID");
    }
    const data = response.data;
    if (
      typeof data.consignment_id !== "string" ||
      data.consignment_id.length < 1 ||
      data.consignment_id.length > 120 ||
      !(
        data.merchant_order_id === undefined ||
        typeof data.merchant_order_id === "string"
      ) ||
      !(
        data.order_status === undefined || typeof data.order_status === "string"
      ) ||
      !(
        data.delivery_fee === undefined ||
        (typeof data.delivery_fee === "number" &&
          Number.isFinite(data.delivery_fee) &&
          data.delivery_fee >= 0)
      )
    ) {
      throw new PathaoRequestError("PATHAO_BOOKING_RESPONSE_INVALID");
    }
    return {
      consignmentId: data.consignment_id,
      merchantOrderId:
        typeof data.merchant_order_id === "string"
          ? data.merchant_order_id
          : null,
      orderStatus:
        typeof data.order_status === "string" ? data.order_status : null,
      deliveryFeeBdt:
        typeof data.delivery_fee === "number" ? data.delivery_fee : null,
    };
  }

  async getOrderInfo(
    config: PathaoConfiguration,
    accessToken: string,
    consignmentId: string,
  ): Promise<PathaoOrderInfo> {
    const response = await this.request(
      config,
      `/aladdin/api/v1/orders/${encodeURIComponent(consignmentId)}/info`,
      { accessToken, method: "GET" },
    );
    if (!isObject(response) || !isObject(response.data)) {
      throw new PathaoRequestError("PATHAO_ORDER_INFO_RESPONSE_INVALID");
    }
    const data = response.data;
    if (
      data.consignment_id !== consignmentId ||
      !(
        data.merchant_order_id === undefined ||
        typeof data.merchant_order_id === "string"
      ) ||
      !(
        data.order_status_slug === undefined ||
        typeof data.order_status_slug === "string"
      ) ||
      !(data.updated_at === undefined || typeof data.updated_at === "string") ||
      !(
        data.invoice_id === undefined ||
        data.invoice_id === null ||
        typeof data.invoice_id === "string"
      )
    ) {
      throw new PathaoRequestError("PATHAO_ORDER_INFO_RESPONSE_INVALID");
    }
    return {
      consignmentId,
      merchantOrderId:
        typeof data.merchant_order_id === "string"
          ? data.merchant_order_id
          : null,
      orderStatus:
        typeof data.order_status_slug === "string"
          ? data.order_status_slug
          : null,
      updatedAt: typeof data.updated_at === "string" ? data.updated_at : null,
      invoiceId: typeof data.invoice_id === "string" ? data.invoice_id : null,
    };
  }

  private async request(
    config: PathaoConfiguration,
    path: string,
    options: {
      method?: "GET" | "POST";
      accessToken?: string;
      body?: unknown;
    },
  ): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(`${config.baseUrl}${path}`, {
        method: options.method ?? "GET",
        redirect: "error",
        signal: AbortSignal.timeout(PATHAO_REQUEST_TIMEOUT_MS),
        headers: {
          Accept: "application/json",
          ...(options.body === undefined
            ? {}
            : { "Content-Type": "application/json" }),
          ...(options.accessToken
            ? { Authorization: `Bearer ${options.accessToken}` }
            : {}),
        },
        ...(options.body === undefined
          ? {}
          : { body: JSON.stringify(options.body) }),
      });
    } catch {
      throw new PathaoRequestError("PATHAO_NETWORK_UNAVAILABLE");
    }

    let text: string;
    try {
      text = await readResponseText(response);
    } catch {
      throw new PathaoRequestError("PATHAO_RESPONSE_INVALID", response.status);
    }
    if (!response.ok) {
      throw new PathaoRequestError(
        `PATHAO_HTTP_${response.status}`,
        response.status,
      );
    }
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new PathaoRequestError("PATHAO_RESPONSE_INVALID", response.status);
    }
  }
}

async function readResponseText(response: Response): Promise<string> {
  if (!response.body) throw new Error("missing body");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error("response too large");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
