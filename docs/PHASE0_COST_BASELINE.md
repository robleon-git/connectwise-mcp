# Phase 0 approved launch-size cost baseline

Status: approved sizing estimate, not a provisioned-resource invoice. Database/endpoint not yet provisioned; initial Phase 0 group/identity/portal shell created under owner approval. Current USD PAYG retail meters checked 2026-10-09; 730 hours/month. Server `monotorr-cw-db-01`, database `connectwise`, North Central US; new private endpoint remains East US. This supersedes the earlier General Purpose launch cost.

| Component | Approved configuration/rate | Monthly estimate |
| --- | --- | --- |
| PostgreSQL compute | Burstable Standard_B1ms, 1 vCPU/2 GiB; $0.017/hour | $12.41 |
| PostgreSQL storage | 32 GiB Premium SSD/ManagedDisk; $0.115 per storage GB-month | $3.68 |
| Private endpoint | One endpoint; $0.01/hour | $7.30 |
| **Fixed database infrastructure subtotal** | **Compute + storage + endpoint** | **$23.39** |

Storage autogrow Enabled; PostgreSQL 18; 14-day automated PITR; HA Disabled; geo-redundant backup Disabled; public access Disabled. Reuse existing East US private endpoint subnet and `privatelink.postgres.database.azure.com` zone/link; add only the new server record. No shared Monotorr database or alternate networking.

Usage/cost exclusions: Private Link processing (first tier $0.01/GB), applicable North America inter-region transfer ($0.02/GB), existing DNS usage, monitoring alert rules/notifications/telemetry, shared log ingestion, excess backup storage, storage growth, taxes and account-specific discounts. The initial backup allowance equals provisioned storage; 14-day retention does not guarantee all backup usage remains within that allowance. This is not the total SaaS bill. API/portal/job estimates are separately listed in [the delivery runbook](V1_AZURE_DELIVERY_RUNBOOK.md).

The owner accepts this intentional V1 launch size, Burstable performance/support limits and cross-region latency/traffic tradeoff. Monitor credits, sustained CPU, memory, active connections/saturation, safe aggregate query latency and storage growth. Retain max-3 service pools/max-1 bootstrap pool. First upgrade: B2s for memory/connections or short bursts; General Purpose for sustained CPU. Neither path requires a new application/data architecture. Scaling/recovery must follow the runbook; storage growth is irreversible.

No new operational ConnectWise data store is included. Only control-plane entities and audit events are persisted; the 39 read-only MCP tools continue querying ConnectWise directly. Monitoring is planned and must be verified during delivery; no claim of deployed monitoring or measured workload capacity is made.

Sources: [PostgreSQL pricing](https://azure.microsoft.com/en-us/pricing/details/postgresql/flexible-server/), [Private Link pricing](https://azure.microsoft.com/en-us/pricing/details/private-link/), [bandwidth pricing](https://azure.microsoft.com/en-us/pricing/details/bandwidth/), [Microsoft retail-price API](https://learn.microsoft.com/en-us/rest/api/cost-management/retail-prices/azure-retail-prices).

## Metric-alert incremental cost verification

The six approved static native-metric rules require no diagnostic-log export or Log Analytics ingestion. Verified retail rate is $0.10 per monitored time series/month beyond the first-ten allowance, so budget up to **$0.60/month** for six single-series rules. Fixed database/endpoint plus metric rules is approximately **$23.99/month** before usage/notifications and any free allowance. No SQL text/query parameters or extra logging ingestion is added to support alerts.
