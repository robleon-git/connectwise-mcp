# V1 ConnectWise Readiness Assessment

## Purpose

The ConnectWise Readiness Assessment is the first structured Monotorr "block."

Its purpose is not to perform a generic ConnectWise configuration audit. It should answer a narrower and more useful question:

> How trustworthy is this ConnectWise environment for understanding the economics and operation of the MSP?

The assessment should provide an immediate, structured "wow" moment after a customer connects Monotorr. It should show that Monotorr understands ConnectWise, understands MSP business structure, and can turn raw PSA data into useful business guidance.

The assessment is intended to:

- prove that the ConnectWise connection is useful;
- teach the owner what Monotorr can help them understand;
- identify where PSA structure or data quality limits business analysis;
- show what is already reliable enough to explore;
- create obvious conversational next steps in the LLM.

The assessment should remain concise, practical, and owner-focused. It should not become a deep forensic audit or ConnectWise consulting engagement.

## V1 Output Shape

The first version should target approximately 20 checks across five categories:

1. Agreement Configuration
2. Service Desk Discipline
3. Labor Cost Accuracy
4. Product Accuracy
5. Business Data Readiness

The UI may show:

- overall readiness score;
- checks passed / checks evaluated;
- findings count;
- readiness by area;
- top findings;
- suggested follow-up actions or prompts.

The score is a summary, not the product. The value comes from the structured findings and the ability to continue the conversation.

## Processing and Retention Principles

Assessment runs are ephemeral.

The intended flow is:

1. The end user invokes the assessment.
2. Monotorr fetches the required ConnectWise data.
3. Monotorr normalizes and evaluates that data in memory.
4. Monotorr returns a structured assessment result to the LLM.
5. The conversation continues in the LLM.
6. Monotorr does not retain the customer business data or completed assessment result.

Monotorr may retain limited product telemetry for operational and product-management purposes, such as:

- account identifier;
- block/tool identifier;
- block version;
- start/completion timestamp;
- success/failure;
- duration;
- error category;
- follow-up action selected, where available.

Monotorr should not retain:

- the readiness score;
- specific findings;
- company names;
- agreement/product/member/ticket data;
- raw ConnectWise responses;
- the completed structured assessment payload.

The architectural principle is:

> Ephemeral customer business data, persistent product telemetry.

## Assessment Design Principles

### Deterministic findings

The readiness assessment should be primarily deterministic. The backend should evaluate known rules against live ConnectWise data and return structured results.

The LLM may explain, summarize, or explore those results conversationally, but it should not be responsible for inventing the underlying readiness findings.

### Facts before inference

Every finding should distinguish:

- observed fact;
- calculated metric;
- inference;
- limitation.

If the available ConnectWise data cannot support a conclusion, the assessment should say so rather than guess.

### Prefer owner-level signals

The assessment should avoid sending the owner into low-value configuration rabbit holes.

A useful finding explains whether the PSA structure supports business analysis and why that matters.

### Advanced practices should be nudges, not failures

Some ConnectWise practices improve reporting but are not required for a healthy MSP.

For example, entering service time directly against agreements can improve margin and consumption analysis, but an MSP should not automatically lose readiness points for not doing so.

These should appear as maturity or analysis-readiness opportunities rather than failures.

### Never blend service and project activity

Service and project work must remain separate.

Service analysis should use service tickets/service time.

Project analysis should use project tickets/tasks/project time.

Some MSPs run projects through service boards instead of the Projects module. That may itself become a finding, but project-like work must not silently contaminate service metrics.

---

# Category 1: Agreement Configuration

## Goal

Determine whether ConnectWise contains a usable, repeatable agreement model that Monotorr can use to understand recurring client relationships, services, products, revenue structure, and eventually margin.

This category should answer:

> Has the MSP built a meaningful agreement model in ConnectWise, and is that model consistent enough to support useful business analysis?

The category should remain high-level. It should not become an exhaustive audit of every historical addition or billing line.

## ConnectWise Agreement Hierarchy

Monotorr must understand master/primary agreements and child/sub-agreements.

A client may have:

- one primary/master agreement;
- multiple child/sub-agreements underneath it;
- products/additions distributed across the children;
- a $0 master agreement because the billable value lives in child agreements or additions.

That structure is valid and should not be treated as a problem.

For reporting and coverage:

- count the master/primary relationship as the agreement;
- do not inflate agreement counts by counting every child as a separate client agreement;
- inspect child/sub-agreements when evaluating structure and components;
- explicitly note when sub-agreements are being used;
- do not flag a $0 primary agreement merely because value is stored in children/additions.

## Check 1: Agreement Model Present

### Question

Is ConnectWise actually being used to structure recurring MSP client relationships, or is it functioning primarily as a ticketing system while billing is handled elsewhere?

### Look for

- primary/master agreements;
- child/sub-agreements;
- agreement additions;
- recurring managed-service components;
- block-time structures;
- per-user billing;
- per-device billing;
- recurring support/base charges;
- recognizable product/service SKUs;
- Microsoft 365, security, backup, firewall/network, and other recurring components.

### Interpretation

Strong evidence of agreement structure means ConnectWise is being used as a meaningful source of business data.

A weak result would be an environment with substantial service activity but little meaningful agreement structure, suggesting billing or service packaging may live outside ConnectWise.

### Important caveat

A $0 agreement header is not itself evidence of missing billing. Monotorr must first determine whether value is represented in additions or child/sub-agreements.

## Check 2: Operationally Active Clients Are Covered by Agreements

### Question

Among companies that appear to be current service clients, how many are represented by a current primary/master agreement relationship?

### Active-client proxy

Do not rely solely on ConnectWise company status because company statuses are highly customizable.

Use recent service activity as the primary signal.

Initial V1 approach:

- approximately 90 days of recent service activity;
- service tickets and/or service time;
- exclude project activity;
- use a reasonable minimum threshold to avoid classifying trivial administrative activity as a managed-client relationship.

The exact threshold remains to be finalized during implementation/testing.

### Evaluation

For operationally active service clients:

- determine whether a current primary/master agreement relationship exists;
- count a master plus its sub-agreements as one agreement relationship;
- identify uncovered active-service companies;
- do not automatically treat uncovered companies as failures.

Valid uncovered relationships may include:

- time-and-materials clients;
- administrative exceptions;
- former clients with residual activity;
- non-managed relationships.

### Output style

Prefer:

> Most companies with recent service activity are represented by a current agreement relationship.

Then optionally identify the small number of exceptions for exploration.

Avoid implying that every company must have an agreement.

## Check 3: Agreement Types Are Consistent and Reportable

### Question

Is Agreement Type being used as a reusable reporting taxonomy?

Agreement Type is valuable because it is a fixed, reportable field. A consistent taxonomy lets Monotorr analyze agreement and revenue data by a stable dimension rather than reconstructing meaning from company names or bespoke agreement names.

### Look for

- Agreement Type populated on primary agreements;
- number of Agreement Types in active use;
- percentage of primary agreements represented by the most common types;
- Agreement Types used only once;
- blank/missing types;
- obvious one-off/customer-specific types;
- evidence of a reusable core taxonomy.

### Interpretation

There is no single ideal number of Agreement Types.

The goal is not to force a naming convention. The goal is to determine whether the MSP has a small enough, reusable enough taxonomy to support meaningful reporting.

A single Agreement Type used consistently may be perfectly valid.

## Check 4: Agreements Are Standardized Rather Than Bespoke

### Question

Within the major Agreement Types, do primary agreements follow recognizable, repeatable patterns, or does every customer appear to have a heavily customized structure?

### Compare at a high level

Where available, compare:

- billing model;
- recurring components;
- child/sub-agreement patterns;
- additions/products;
- quantity model;
- pricing structure;
- recurring charges.

### Interpretation

The assessment is not judging whether the MSP charges the "right" amount.

It is looking for sameness and repeatability.

Useful output might be:

> Your managed-service agreements show a recognizable repeatable structure, with some customer-specific variation.

Or:

> Agreements using the same Agreement Type contain materially different structures, which may make package and margin comparison harder.

### Do not over-audit

Avoid deep forensic findings about every historical SKU, duplicate-looking addition, or price change unless the evidence clearly establishes a current business problem.

Historical additions and pricing changes may legitimately remain in ConnectWise.

The readiness assessment should surface structural patterns, not send the user into agreement archaeology.

---

## Agreement Configuration Scoring Guidance

The four checks should remain conceptually distinct:

1. Agreement Model Present
2. Active Client Coverage
3. Agreement Type Consistency
4. Agreement Standardization

Potential results:

- Strong
- Good
- Needs Attention
- Poor
- Not Enough Data

The final scoring formula and thresholds are not yet locked.

Advanced reporting practices should not automatically reduce the score.

## Agreement Configuration Maturity Opportunity

### Time entered against agreements

Entering service time directly against agreements can improve:

- agreement consumption analysis;
- service-cost reporting;
- agreement profitability;
- margin confidence.

However, this is a ConnectWise usage preference and a more advanced reporting practice.

Therefore:

- do not score an MSP down simply because service time is recorded against the company instead of the agreement;
- if detected, surface it as a recommendation or maturity opportunity;
- explain the benefit without framing it as a configuration failure.

Example:

> Recording service time directly against agreements would improve service-consumption and margin analysis. Your current data can still be analyzed, but agreement-level labor reporting will be less precise.

---

## Agreement Configuration Example Output

### Agreement Configuration — Good

You have a real agreement structure in ConnectWise, including recurring service components and reusable Agreement Types. Sub-agreements are being used to organize some client billing/service components.

**What we found**

- Most companies with recent service activity are represented by a current agreement relationship.
- Agreement Types are consistently populated and reusable for reporting.
- Master/sub-agreement relationships are present and treated as consolidated client agreements.
- Major managed-service agreements show recognizable repeatable structures, with some customer-specific variation.

**Opportunity**

Recording service time directly against agreements would improve agreement-level labor and margin analysis. This is an advanced reporting practice rather than a readiness requirement.

**Explore**

> Show me the active service clients without a current agreement relationship.

---

# Remaining Categories

The following categories are planned but not yet fully defined.

## Service Desk Discipline

### Goal

Determine whether service data is complete and structured enough to measure client service consumption.

This category is intentionally not a service-desk maturity audit. Monotorr should not grade SLA design, priority schemes, type/subtype/item usage, dispatch process, escalation workflow, ticket closure hygiene, or queue-management conventions.

The business question is:

> Can Monotorr trust the service data enough to understand how much support effort each client consumes?

That information becomes a foundation for lightweight client profitability and operational analysis.

### Check 1: Service Activity Is Being Captured

Determine whether enough service ticket and time-entry data exists to represent the service work being performed.

The goal is not perfect ticket hygiene or complete minute-by-minute accounting. The goal is to establish whether the dataset is sufficiently complete for useful client-level analysis.

Potential signals include:

- recent service tickets;
- service time entries;
- distribution of time across active service clients;
- obvious gaps where substantial ticket activity exists with little or no recorded time.

If the data appears incomplete, describe the limitation without turning the assessment into a ticket-process audit.

### Check 2: Service and Project Work Can Be Separated

Service and project activity must never be silently blended.

Where ConnectWise Projects is used, project tickets/tasks/time should remain separate from normal service activity.

Some MSPs do project work through service boards instead of the Projects module. This can be especially common in T&M-heavy environments.

If project-like work appears to be mixed into service activity, surface that as a data-confidence limitation rather than a service-desk failure.

Example:

> Project-like work appears to be mixed into service activity. Client service-consumption metrics may therefore include project labor.

The assessment must not compare or aggregate project and service effort as though they are the same type of work.

### Check 3: Client Service Consumption Is Measurable

Determine whether Monotorr can reliably calculate service consumption by client.

Useful measures may include:

- total service hours;
- service hours per month;
- ticket count;
- average time per ticket;
- trend over time.

The key output is not a service-desk score. It is confidence that Monotorr can say, for a given client:

> This client consumes approximately X hours of service time per month and generates Y service tickets.

This check should exclude project activity wherever possible.

### Check 4: Service Consumption Can Be Normalized

Determine whether enough customer-size data exists to make service consumption meaningful across clients.

Potential denominators may include:

- managed users;
- managed workstations;
- managed devices;
- agreement quantities;
- other stable configuration counts that reasonably represent customer size.

Monotorr should not require every MSP to use the same denominator.

The goal is to determine whether service effort can be normalized into measures such as:

- service hours per managed user;
- service hours per managed workstation;
- service hours per managed device.

This allows more meaningful comparison than raw ticket or hour counts alone.

If the denominator data is not reliable enough, report that limitation rather than inventing a normalized metric.

### Agreement Attribution Is an Advanced Practice

Entering service time directly against agreements can improve:

- agreement consumption analysis;
- service-cost reporting;
- agreement-level profitability;
- margin confidence.

However, this is a ConnectWise usage preference and a more advanced reporting practice.

Do not score an MSP down solely because service time is associated with the company rather than directly with an agreement.

Surface it as a maturity opportunity when relevant.

### Profitability Context

Service Desk Discipline is one input into lightweight profitability analysis.

When service consumption is measurable and member labor cost data is available, Monotorr may eventually estimate client labor cost.

When product costs and agreement structure are also sufficiently complete, Monotorr can move toward a broader profitability estimate.

Monotorr should communicate confidence rather than overstate precision.

For example:

> Profitability estimate: Moderate confidence. Service labor appears complete, but product costs are missing for several agreement additions.

The assessment should distinguish:

- what can be calculated confidently;
- what can be estimated;
- what should not yet be claimed.

## Labor Cost Accuracy

Purpose: determine whether active members have realistic usable hourly labor cost data and whether enough recorded labor is covered by those costs to support margin analysis.

## Product Accuracy

Purpose: determine whether MSP products/services exist as recognizable SKUs and whether agreement products contain usable costs, prices, and quantities.

Without product cost data, product and agreement margin calculations are estimates rather than trustworthy business metrics.

## Business Data Readiness

Purpose: determine whether the broader ConnectWise environment contains enough consistent structural information to support useful owner-level business analysis.

This category should avoid low-value CRM housekeeping and focus on business-analysis readiness.

---

# Future Block Pattern

The readiness assessment should establish the reusable pattern for future Monotorr blocks:

1. Run a deterministic read-only analysis.
2. Return a structured visual summary.
3. Surface the most important findings.
4. Offer guided follow-up actions.
5. Continue exploration conversationally through the LLM.

The ConnectWise data remains authoritative in ConnectWise. Monotorr reads and analyzes it live, returns the result, and does not maintain a shadow business-data warehouse.
