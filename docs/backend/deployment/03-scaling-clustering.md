# Production Scaling, Clustering & Load Balancing

> **Framework Compatibility**: NestJS v11+ / v12  
> **Infrastructure Target**: Kubernetes / AWS ALB / Nginx / Docker  
> **Runtime Target**: Node.js 24 LTS / Pure ECMAScript Modules (ESM) / TypeScript Strict Mode

Scaling a NestJS application to handle tens of thousands of concurrent requests requires a strictly stateless architecture backed by intelligent load balancing, container orchestration, and reverse proxy routing.

---

## 1. Container Replicas vs. Node.js In-Process Clustering

In the past, Node.js applications frequently utilized the built-in `cluster` module (or process managers like PM2) to fork child processes on a single multicore server.

In modern cloud environments, **container orchestration (Kubernetes / AWS ECS) is vastly superior to in-process clustering**:

| Architectural Aspect | Container Replicas (Kubernetes / ECS) | In-Process Node `cluster` / PM2 |
| :--- | :--- | :--- |
| **Fault Isolation** | Complete container/cgroup isolation. A fatal OOM crash in Pod A has zero impact on Pod B. | A kernel panic or host memory exhaustion kills all forked worker processes simultaneously. |
| **Zero-Downtime Rollouts**| Kubernetes performs declarative rolling updates, verifying health probes before terminating old pods. | In-process reload can cause dropped in-flight socket connections and race conditions. |
| **Autoscaling (HPA)** | Autoscaler dynamically spins up new pods across a distributed cluster based on CPU/memory metrics. | Bound to the physical CPU cores of a single virtual machine. |
| **Log Aggregation** | Standard container `stdout`/`stderr` collected cleanly by DaemonSets (FluentBit, Datadog). | Multi-process stdout interleaving requires custom file logging and log rotation tooling. |

---

## 2. Ingress & Reverse Proxy Architecture (Nginx)

When placing NestJS behind an Nginx reverse proxy, the proxy must properly handle WebSocket connection upgrades, HTTP/2 multiplexing, and client IP forwarding:

```nginx
# /etc/nginx/conf.d/aaraj-api.conf
upstream nestjs_backend {
    server 10.0.1.10:3000 max_fails=3 fail_timeout=10s;
    server 10.0.1.11:3000 max_fails=3 fail_timeout=10s;
    keepalive 64;
}

server {
    listen 443 ssl http2;
    server_name api.aaraj.io;

    ssl_certificate /etc/letsencrypt/live/api.aaraj.io/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.aaraj.io/privkey.pem;

    # Performance Tuning
    client_max_body_size 50M;
    keepalive_timeout 65;

    location / {
        proxy_pass http://nestjs_backend;
        proxy_http_version 1.1;

        # WebSocket Connection Upgrade Support
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        # Client IP and Host Forwarding
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Prevent idle WebSocket drops (1 hour timeout)
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}
```

---

## 3. Kubernetes Deployment & Horizontal Pod Autoscaler (HPA)

### 3.1 Kubernetes Deployment Manifest

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: aaraj-api
  labels:
    app: aaraj-api
spec:
  replicas: 3
  selector:
    matchLabels:
      app: aaraj-api
  template:
    metadata:
      labels:
        app: aaraj-api
    spec:
      containers:
        - name: aaraj-api
          image: 123456789012.dkr.ecr.us-east-1.amazonaws.com/aaraj-api:v1.0.0
          imagePullPolicy: IfNotPresent
          ports:
            - containerPort: 3000
          env:
            - name: NODE_ENV
              value: "production"
            - name: PORT
              value: "3000"
          resources:
            requests:
              cpu: "250m"
              memory: "512Mi"
            limits:
              cpu: "1000m"
              memory: "1024Mi"
          livenessProbe:
            httpGet:
              path: /health/liveness
              port: 3000
            initialDelaySeconds: 15
            periodSeconds: 10
          readinessProbe:
            httpGet:
              path: /health/readiness
              port: 3000
            initialDelaySeconds: 5
            periodSeconds: 5
```

### 3.2 Horizontal Pod Autoscaler (HPA)

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: aaraj-api-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: aaraj-api
  minReplicas: 3
  maxReplicas: 20
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 75
    - type: Resource
      resource:
        name: memory
        target:
          type: Utilization
          averageUtilization: 80
```

---

## 4. Stateless Service Architectural Principles

To guarantee that any pod in the cluster can handle any incoming request interchangeably:

1. **Shared Cache & Sessions**: Store distributed user sessions, tokens, and temporary state in a managed Redis cluster instead of in-memory maps.
2. **Distributed WebSocket Broadcasting**: Connect all NestJS WebSocket gateways to `@socket.io/redis-adapter` so events emitted on Pod A are delivered to sockets connected to Pod B.
3. **Distributed Job Locks**: Ensure scheduled CRON jobs or background processing tasks are decorated with `@OnOneInstance()` via `@nestjs/locks` to prevent duplicate task execution across replicas.
4. **Idempotent Ingress**: Decorate mutating financial or state-change HTTP endpoints with `@IdempotencyKey()` to prevent network retry duplication.
