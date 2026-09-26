# Microservices: MQTT Transporter

> **Source**: https://docs.nestjs.com/microservices/mqtt  
> **Framework Compatibility**: NestJS v11+ / v12 (`@nestjs/microservices`, `mqtt`)  
> **Runtime Target**: Node.js 24 LTS / Pure ECMAScript Modules (ESM) / TypeScript Strict Mode

[MQTT](https://mqtt.org/) (Message Queuing Telemetry Transport) is an open-source, lightweight, publish/subscribe messaging protocol designed for constrained edge devices, low-bandwidth connections, and high-latency IoT networks.

---

## 1. Installation & Driver Setup

To build MQTT-based microservices, install the official [MQTT.js](https://github.com/mqttjs/MQTT.js) client library:

```bash
pnpm add mqtt
```

---

## 2. Server Configuration

Pass `Transport.MQTT` and the broker URL to `createMicroservice()`:

```typescript
// src/main.ts
import { NestFactory } from '@nestjs/core';
import { Transport, MicroserviceOptions } from '@nestjs/microservices';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    AppModule,
    {
      transport: Transport.MQTT,
      options: {
        url: process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883',
        subscribeOptions: {
          qos: 1, // Default Quality of Service level
        },
        maxConnectionAttempts: 10,
      },
    },
  );

  await app.listen();
}
void bootstrap();
```

---

## 3. Subscriptions, Wildcards & Quality of Service (QoS)

MQTT topics use hierarchical forward-slash notation and support two wildcard characters:
- `+`: Single-level wildcard (matches exactly one topic segment).
- `#`: Multi-level wildcard (matches any number of hierarchical topic segments).

```typescript
// src/telemetry/telemetry.controller.ts
import { Controller } from '@nestjs/common';
import { MessagePattern, EventPattern, Payload, Ctx } from '@nestjs/microservices';
import { MqttContext } from '@nestjs/microservices';

@Controller()
export class TelemetryController {
  /**
   * Single-Level Wildcard:
   * Matches 'sensors/floor-1/temperature/rack-A'
   */
  @EventPattern('sensors/+/temperature/+')
  handleTemperature(
    @Payload() reading: { value: number; unit: string },
    @Ctx() context: MqttContext,
  ): void {
    console.log(`Topic: ${context.getTopic()}`);
    console.log(`Raw Packet:`, context.getPacket());
  }

  /**
   * Per-Pattern QoS Override:
   * Patterns without an explicit QoS inherit the global subscribeOptions.qos value.
   */
  @EventPattern('devices/critical/#', { qos: 2 })
  handleCriticalDeviceAlert(
    @Payload() data: unknown,
    @Ctx() context: MqttContext,
  ): void {
    console.log(`High-priority QoS 2 event received on: ${context.getTopic()}`);
  }
}
```

---

## 4. Advanced Message Options: Record Builders

To configure packet headers, QoS levels, retain flags, or custom MQTT 5.0 user properties, use `MqttRecordBuilder`:

### 4.1 Dispatching via Record Builder

```typescript
// src/telemetry/telemetry.service.ts
import { Injectable, Inject } from '@nestjs/common';
import { ClientProxy, MqttRecordBuilder } from '@nestjs/microservices';

@Injectable()
export class TelemetryService {
  constructor(
    @Inject('MQTT_CLIENT') private readonly client: ClientProxy,
  ) {}

  publishSensorUpdate(sensorId: string, reading: number): void {
    const userProperties = {
      'device-firmware': 'v2.4.1',
      'tenant-id': 'org_123',
    };

    const record = new MqttRecordBuilder({ reading, timestamp: Date.now() })
      .setQoS(1)
      .setProperties({ userProperties })
      .build();

    this.client.emit(`sensors/${sensorId}/metrics`, record);
  }
}
```

### 4.2 Inspecting User Properties on Ingress

```typescript
@EventPattern('sensors/+/metrics')
handleSensorMetrics(
  @Payload() data: { reading: number },
  @Ctx() context: MqttContext,
): void {
  const packet = context.getPacket();
  const userProperties = packet.properties?.userProperties;
  console.log(`Firmware: ${userProperties?.['device-firmware']}`);
}
```

---

## 5. Driver Telemetry & Low-Level Access

```typescript
import { MqttStatus, MqttEvents } from '@nestjs/microservices';
import type { MqttClient } from 'mqtt';

// Status stream emits: 'connected' | 'disconnected' | 'reconnecting' | 'closed'
this.client.status.subscribe((status: MqttStatus) => {
  console.log(`MQTT Client connection status: ${status}`);
});

this.client.on('error', (err) => {
  console.error('MQTT transport error:', err);
});

// Access the underlying MQTT.js client instance
const mqttClient = this.client.unwrap<MqttClient>();
```
