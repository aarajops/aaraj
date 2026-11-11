"use client";

import { useEffect, useRef, useState } from "react";
import type {
  CourierRemittanceBatch,
  ImportCourierRemittanceInput,
} from "@aaraj/contracts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatBdtPrice } from "@/lib/currency";
import {
  fetchCourierRemittances,
  importCourierRemittance,
  reconcileCourierRemittance,
  resolveCourierRemittanceLine,
  confirmCourierSettlement,
} from "./orders-client";

type StatementLine = ImportCourierRemittanceInput["lines"][number];
const csvHeaders = [
  "consignmentRef",
  "collectedAmountBdt",
  "feeAmountBdt",
  "netAmountBdt",
] as const;

export function CourierRemittancesManager() {
  const [batches, setBatches] = useState<CourierRemittanceBatch[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [merchantAccountRef, setMerchantAccountRef] = useState("");
  const [providerRemittanceRef, setProviderRemittanceRef] = useState("");
  const [receivedAt, setReceivedAt] = useState(localDateTimeValue);
  const [statementTotalBdt, setStatementTotalBdt] = useState("");
  const [lines, setLines] = useState<StatementLine[]>([]);
  const [sourceName, setSourceName] = useState("");
  const [reconciliationReason, setReconciliationReason] = useState("");
  const [acceptedDiscrepancy, setAcceptedDiscrepancy] = useState(false);
  const [bankReference, setBankReference] = useState("");
  const [bankAmountBdt, setBankAmountBdt] = useState("");
  const [bankConfirmationReason, setBankConfirmationReason] = useState("");
  const [externalReasons, setExternalReasons] = useState<
    Record<string, string>
  >({});
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const commandIds = useRef(new Map<string, string>());

  const selectedBatch =
    batches.find((batch) => batch.id === selectedId) ?? null;

  useEffect(() => {
    let active = true;
    async function loadBatches() {
      try {
        const result = await fetchCourierRemittances();
        if (!active) return;
        setBatches(result);
        setSelectedId((current) => current || result[0]?.id || "");
      } catch (reason) {
        if (active)
          setError(
            messageOf(reason, "Courier remittances could not be loaded."),
          );
      }
    }
    void loadBatches();
    return () => {
      active = false;
    };
  }, []);

  async function runCommand<T>(
    key: string,
    payload: unknown,
    send: (commandId: string) => Promise<T>,
    onSuccess: (result: T) => void,
  ) {
    const fingerprint = `${key}:${JSON.stringify(payload)}`;
    const commandId =
      commandIds.current.get(fingerprint) ?? crypto.randomUUID();
    commandIds.current.set(fingerprint, commandId);
    setPending(key);
    setError(null);
    try {
      const result = await send(commandId);
      commandIds.current.delete(fingerprint);
      onSuccess(result);
    } catch (reason) {
      setError(
        messageOf(
          reason,
          "The finance operation could not be saved. Retry with the same details.",
        ),
      );
    } finally {
      setPending(null);
    }
  }

  function applyBatch(batch: CourierRemittanceBatch) {
    setBatches((current) => [
      batch,
      ...current.filter((entry) => entry.id !== batch.id),
    ]);
    setSelectedId(batch.id);
  }

  async function importStatement() {
    const payload = {
      provider: "pathao" as const,
      merchantAccountRef,
      providerRemittanceRef,
      receivedAt: new Date(receivedAt).toISOString(),
      statementTotalBdt: Number(statementTotalBdt),
      lines,
    };
    await runCommand(
      `import:${providerRemittanceRef}`,
      payload,
      (commandId) => importCourierRemittance({ commandId, ...payload }),
      (result) => applyBatch(result),
    );
  }

  async function resolveExternalLine(
    batch: CourierRemittanceBatch,
    lineId: string,
  ) {
    const reason = externalReasons[lineId] ?? "";
    await runCommand(
      `external:${batch.id}:${lineId}`,
      { disposition: "external", reason },
      (commandId) =>
        resolveCourierRemittanceLine(batch.id, lineId, {
          commandId,
          disposition: "external",
          reason,
        }),
      applyBatch,
    );
  }

  async function reconcile(batch: CourierRemittanceBatch) {
    const payload = { reason: reconciliationReason, acceptedDiscrepancy };
    await runCommand(
      `reconcile:${batch.id}`,
      payload,
      (commandId) =>
        reconcileCourierRemittance(batch.id, { commandId, ...payload }),
      applyBatch,
    );
  }

  async function confirmBankSettlement(batch: CourierRemittanceBatch) {
    const payload = {
      bankReference,
      bankAmountBdt: Number(bankAmountBdt),
      reason: bankConfirmationReason,
    };
    await runCommand(
      `bank:${batch.id}`,
      payload,
      (commandId) =>
        confirmCourierSettlement(batch.id, { commandId, ...payload }),
      applyBatch,
    );
  }

  async function readStatementFile(file?: File) {
    if (!file) return;
    setError(null);
    setSourceName(file.name);
    if (file.size > 2_000_000) {
      setError("Statement CSV must be 2 MB or smaller.");
      return;
    }
    try {
      setLines(parseStatementCsv(await file.text()));
    } catch (reason) {
      setLines([]);
      setError(messageOf(reason, "The statement CSV could not be parsed."));
    }
  }

  return (
    <div>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Pathao remittances</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Import statement rows, match AARAJ COD collections, record
            exceptions, and close the remittance with a reason.
          </p>
        </div>
        <label className="grid gap-1 text-sm font-medium">
          Imported batch
          <select
            className="h-10 min-w-64 rounded-md border border-input bg-background px-3"
            value={selectedId}
            onChange={(event) => setSelectedId(event.target.value)}
          >
            <option value="">Select a batch</option>
            {batches.map((batch) => (
              <option key={batch.id} value={batch.id}>
                {batch.providerRemittanceRef} · {batch.status} ·{" "}
                {new Date(batch.receivedAt).toLocaleDateString()}
              </option>
            ))}
          </select>
        </label>
      </header>

      <section className="mt-6 grid gap-4 rounded-2xl border border-border p-5 sm:p-7">
        <h2 className="text-lg font-semibold">Import a statement</h2>
        <p className="text-sm text-muted-foreground">
          Use a CSV with columns{" "}
          <code>
            consignmentRef,collectedAmountBdt,feeAmountBdt,netAmountBdt
          </code>
          . The original provider report must stay in the finance evidence
          archive; AARAJ stores normalized rows and their content hash.
        </p>
        <label className="grid gap-2 text-sm font-medium">
          Statement CSV
          <Input
            accept=".csv,text/csv"
            onChange={(event) =>
              void readStatementFile(event.target.files?.[0])
            }
            type="file"
          />
        </label>
        {sourceName && (
          <p className="text-xs text-muted-foreground">
            Loaded {sourceName} · {lines.length} statement rows
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-sm font-medium">
            Pathao merchant account reference
            <Input
              maxLength={120}
              value={merchantAccountRef}
              onChange={(event) => setMerchantAccountRef(event.target.value)}
            />
          </label>
          <label className="grid gap-1 text-sm font-medium">
            Provider remittance reference
            <Input
              maxLength={160}
              value={providerRemittanceRef}
              onChange={(event) => setProviderRemittanceRef(event.target.value)}
            />
          </label>
          <label className="grid gap-1 text-sm font-medium">
            Received at
            <Input
              type="datetime-local"
              value={receivedAt}
              onChange={(event) => setReceivedAt(event.target.value)}
            />
          </label>
          <label className="grid gap-1 text-sm font-medium">
            Statement total, BDT
            <Input
              inputMode="numeric"
              min={0}
              type="number"
              value={statementTotalBdt}
              onChange={(event) => setStatementTotalBdt(event.target.value)}
            />
          </label>
        </div>
        {lines.length > 0 && (
          <div className="max-h-56 overflow-auto rounded-lg border border-border">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-background">
                <tr>
                  {csvHeaders.map((header) => (
                    <th className="p-2" key={header}>
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lines.slice(0, 100).map((line) => (
                  <tr
                    className="border-t border-border"
                    key={line.consignmentRef}
                  >
                    {[
                      line.consignmentRef,
                      line.collectedAmountBdt,
                      line.feeAmountBdt,
                      line.netAmountBdt,
                    ].map((value, index) => (
                      <td className="p-2" key={index}>
                        {value}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {lines.length > 100 && (
              <p className="p-2 text-xs text-muted-foreground">
                Showing the first 100 of {lines.length} rows.
              </p>
            )}
          </div>
        )}
        <Button
          disabled={
            Boolean(pending) ||
            !merchantAccountRef.trim() ||
            !providerRemittanceRef.trim() ||
            !receivedAt ||
            !Number.isSafeInteger(Number(statementTotalBdt)) ||
            lines.length === 0
          }
          onClick={() => void importStatement()}
        >
          {pending?.startsWith("import:")
            ? "Importing…"
            : "Import normalized statement"}
        </Button>
      </section>

      {error && (
        <p
          className="mt-4 rounded-lg border border-destructive/40 p-3 text-sm text-destructive"
          role="alert"
        >
          {error}
        </p>
      )}

      {selectedBatch && (
        <section className="mt-6 grid gap-5 rounded-2xl border border-border p-5 sm:p-7">
          <header className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">
                Remittance {selectedBatch.providerRemittanceRef}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Account {selectedBatch.merchantAccountRef} · received{" "}
                {new Date(selectedBatch.receivedAt).toLocaleString()} · content
                SHA-256 {selectedBatch.statementSha256}
              </p>
            </div>
            <span className="rounded-full border px-3 py-1 text-sm">
              {selectedBatch.status}
            </span>
          </header>
          <dl className="grid gap-3 sm:grid-cols-3">
            <Summary
              label="Statement total"
              amount={selectedBatch.statementTotalBdt}
            />
            <Summary
              label="Imported net rows"
              amount={selectedBatch.linesTotalBdt}
            />
            <Summary
              label="Net variance"
              amount={selectedBatch.totalVarianceBdt}
              signed
            />
          </dl>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead>
                <tr className="border-b border-border">
                  {[
                    "Consignment",
                    "Order",
                    "Expected COD",
                    "Statement COD",
                    "Fee",
                    "Net",
                    "Variance",
                    "Review",
                  ].map((column) => (
                    <th className="p-2" key={column}>
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {selectedBatch.lines.map((line) => (
                  <tr
                    className="border-t border-border align-top"
                    key={line.id}
                  >
                    <td className="p-2">{line.consignmentRef}</td>
                    <td className="p-2">
                      {line.orderReference ?? "Unmatched"}
                    </td>
                    <td className="p-2">
                      {line.expectedCollectedAmountBdt === null
                        ? "—"
                        : formatBdtPrice({
                            amountBdt: line.expectedCollectedAmountBdt,
                          })}
                    </td>
                    <td className="p-2">
                      {formatBdtPrice({ amountBdt: line.collectedAmountBdt })}
                    </td>
                    <td className="p-2">
                      {formatBdtPrice({ amountBdt: line.feeAmountBdt })}
                    </td>
                    <td className="p-2">
                      {formatBdtPrice({ amountBdt: line.netAmountBdt })}
                    </td>
                    <td className="p-2">
                      {line.varianceBdt === null
                        ? "—"
                        : formatSignedBdt(line.varianceBdt)}
                    </td>
                    <td className="min-w-64 p-2">
                      {line.resolutionStatus === "pending" &&
                      selectedBatch.status === "open" ? (
                        <div className="grid gap-2">
                          <Textarea
                            aria-label={`External line reason for ${line.consignmentRef}`}
                            maxLength={500}
                            minLength={3}
                            placeholder="Why this statement row is outside AARAJ orders"
                            value={externalReasons[line.id] ?? ""}
                            onChange={(event) =>
                              setExternalReasons((current) => ({
                                ...current,
                                [line.id]: event.target.value,
                              }))
                            }
                          />
                          <Button
                            disabled={
                              Boolean(pending) ||
                              (externalReasons[line.id] ?? "").trim().length < 3
                            }
                            onClick={() =>
                              void resolveExternalLine(selectedBatch, line.id)
                            }
                            variant="outline"
                          >
                            Accept as external
                          </Button>
                        </div>
                      ) : (
                        <span>
                          {line.resolutionStatus === "external"
                            ? `External · ${line.resolutionReason}`
                            : line.resolutionStatus}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {selectedBatch.status === "open" && (
            <div className="grid gap-3 rounded-lg border border-border p-4">
              <label className="flex items-start gap-3 text-sm">
                <input
                  checked={acceptedDiscrepancy}
                  onChange={(event) =>
                    setAcceptedDiscrepancy(event.target.checked)
                  }
                  type="checkbox"
                />
                <span>
                  I reviewed the amount and collection differences and accept
                  the recorded variance, if any.
                </span>
              </label>
              <label className="grid gap-2 text-sm font-medium">
                Finance reconciliation reason
                <Textarea
                  maxLength={500}
                  minLength={3}
                  value={reconciliationReason}
                  onChange={(event) =>
                    setReconciliationReason(event.target.value)
                  }
                />
              </label>
              <Button
                disabled={
                  Boolean(pending) ||
                  selectedBatch.lines.some(
                    (line) =>
                      line.resolutionStatus === "pending" ||
                      (line.resolutionStatus === "matched" &&
                        line.expectedCollectedAmountBdt === null),
                  ) ||
                  reconciliationReason.trim().length < 3 ||
                  ((selectedBatch.totalVarianceBdt !== 0 ||
                    selectedBatch.lines.some(
                      (line) =>
                        line.varianceBdt !== null && line.varianceBdt !== 0,
                    ) ||
                    selectedBatch.lines.some(
                      (line) => line.resolutionStatus === "external",
                    )) &&
                    !acceptedDiscrepancy)
                }
                onClick={() => void reconcile(selectedBatch)}
              >
                {pending === `reconcile:${selectedBatch.id}`
                  ? "Saving…"
                  : "Reconcile remittance"}
              </Button>
            </div>
          )}
          {selectedBatch.reconciliationReason && (
            <p className="text-sm text-muted-foreground">
              Reconciled: {selectedBatch.reconciliationReason}
            </p>
          )}
          {selectedBatch.status === "reconciled" &&
            !selectedBatch.bankConfirmation && (
              <div className="grid gap-3 rounded-lg border border-border p-4">
                <p className="text-sm text-muted-foreground">
                  Confirm the actual bank credit from the bank statement or
                  account before posting. A provider remittance statement alone
                  is not proof that cash reached the bank. The journal records
                  bank cash, courier fee, COD settlement clearing, and any
                  variance in suspense; it does not decide revenue recognition
                  or VAT treatment.
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="grid gap-1 text-sm font-medium">
                    Bank transaction reference
                    <Input
                      maxLength={160}
                      value={bankReference}
                      onChange={(event) => setBankReference(event.target.value)}
                    />
                  </label>
                  <label className="grid gap-1 text-sm font-medium">
                    Actual bank credit, BDT
                    <Input
                      inputMode="numeric"
                      min={0}
                      type="number"
                      value={bankAmountBdt}
                      onChange={(event) => setBankAmountBdt(event.target.value)}
                    />
                  </label>
                </div>
                <label className="grid gap-2 text-sm font-medium">
                  Evidence note
                  <Textarea
                    maxLength={500}
                    minLength={3}
                    value={bankConfirmationReason}
                    onChange={(event) =>
                      setBankConfirmationReason(event.target.value)
                    }
                  />
                </label>
                <Button
                  disabled={
                    Boolean(pending) ||
                    !bankReference.trim() ||
                    !Number.isSafeInteger(Number(bankAmountBdt)) ||
                    Number(bankAmountBdt) < 0 ||
                    bankConfirmationReason.trim().length < 3
                  }
                  onClick={() => void confirmBankSettlement(selectedBatch)}
                >
                  {pending === `bank:${selectedBatch.id}`
                    ? "Posting…"
                    : "Confirm bank credit and post journal"}
                </Button>
              </div>
            )}
          {selectedBatch.bankConfirmation && (
            <div className="grid gap-3 rounded-lg border border-border p-4">
              <h3 className="font-semibold">
                Posted settlement journal{" "}
                {selectedBatch.bankConfirmation.journalId}
              </h3>
              <p className="text-sm text-muted-foreground">
                Bank reference {selectedBatch.bankConfirmation.bankReference} ·
                confirmed credit{" "}
                {formatBdtPrice({
                  amountBdt: selectedBatch.bankConfirmation.bankAmountBdt,
                })}{" "}
                · variance{" "}
                {formatSignedBdt(selectedBatch.bankConfirmation.varianceBdt)}
              </p>
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="p-2">Account</th>
                    <th className="p-2">Debit</th>
                    <th className="p-2">Credit</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedBatch.bankConfirmation.entries.map(
                    (entry, index) => (
                      <tr
                        className="border-t border-border"
                        key={`${entry.accountKey}-${index}`}
                      >
                        <td className="p-2">
                          {entry.accountKey.replaceAll("_", " ")}
                        </td>
                        <td className="p-2">
                          {entry.debitBdt
                            ? formatBdtPrice({ amountBdt: entry.debitBdt })
                            : "—"}
                        </td>
                        <td className="p-2">
                          {entry.creditBdt
                            ? formatBdtPrice({ amountBdt: entry.creditBdt })
                            : "—"}
                        </td>
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
              <p className="text-xs text-muted-foreground">
                Journal postings are balanced and immutable. Tax classification
                and revenue recognition remain subject to the configured
                accounting policy.
              </p>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function Summary({
  label,
  amount,
  signed = false,
}: {
  label: string;
  amount: number;
  signed?: boolean;
}) {
  return (
    <div className="rounded-lg bg-muted/40 p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-semibold tabular-nums">
        {signed
          ? formatSignedBdt(amount)
          : formatBdtPrice({ amountBdt: amount })}
      </dd>
    </div>
  );
}

function formatSignedBdt(amount: number) {
  return `${amount > 0 ? "+" : amount < 0 ? "−" : ""}${formatBdtPrice({ amountBdt: Math.abs(amount) })}`;
}

function localDateTimeValue() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
}

function parseStatementCsv(source: string): StatementLine[] {
  const rows = parseCsv(source.replace(/^\uFEFF/, ""));
  const header = rows.shift()?.map((cell) => cell.trim());
  if (!header || csvHeaders.some((name) => !header.includes(name))) {
    throw new Error(`CSV header must contain ${csvHeaders.join(", ")}.`);
  }
  if (rows.length === 0 || rows.length > 5000)
    throw new Error("CSV must contain between 1 and 5000 data rows.");
  const indexes = csvHeaders.map((name) => header.indexOf(name));
  return rows
    .filter((row) => row.some((cell) => cell.trim()))
    .map((row, index) => {
      if (row.length !== header.length)
        throw new Error(
          `CSV row ${index + 2} has the wrong number of columns.`,
        );
      const values = indexes.map((column) => row[column]?.trim() ?? "");
      const consignmentRef = values[0] ?? "";
      const collectedRaw = values[1] ?? "";
      const feeRaw = values[2] ?? "";
      const netRaw = values[3] ?? "";
      const collectedAmountBdt = Number(collectedRaw);
      const feeAmountBdt = Number(feeRaw);
      const netAmountBdt = Number(netRaw);
      if (
        !consignmentRef ||
        !collectedRaw ||
        !feeRaw ||
        !netRaw ||
        ![collectedAmountBdt, feeAmountBdt, netAmountBdt].every(
          Number.isSafeInteger,
        )
      ) {
        throw new Error(
          `CSV row ${index + 2} has an invalid consignment or BDT amount.`,
        );
      }
      return { consignmentRef, collectedAmountBdt, feeAmountBdt, netAmountBdt };
    });
}

function parseCsv(source: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]!;
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        cell += character;
      }
    } else if (character === '"' && cell.length === 0) {
      quoted = true;
    } else if (character === ",") {
      row.push(cell);
      cell = "";
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && source[index + 1] === "\n") index += 1;
      row.push(cell);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }
  if (quoted) throw new Error("CSV contains an unclosed quoted field.");
  row.push(cell);
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}

function messageOf(value: unknown, fallback: string) {
  return value instanceof Error ? value.message : fallback;
}
