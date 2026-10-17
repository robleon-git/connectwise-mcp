# V1 Business Visibility Block

## Purpose

Business Visibility is the first structured Monotorr block.

Its purpose is not to audit ConnectWise configuration, grade an MSP against a universal best-practice checklist, or turn Monotorr into a ConnectWise consulting product.

Its purpose is to answer a simpler and more useful question:

> What useful business insight can Monotorr reliably extract from the ConnectWise data you actually have?

ConnectWise is highly customizable. Different MSPs use agreements, products, service boards, projects, company statuses, member fields, and billing structures in different ways.

Monotorr should not try to outsmart every possible implementation.

Instead, Business Visibility should:

- identify the business signals Monotorr can see clearly;
- identify where the data is incomplete, ambiguous, or difficult to interpret;
- explain what those limitations mean for future analysis;
- show the owner what they can confidently ask Monotorr now;
- identify a small number of improvements that would make the business easier to analyze;
- create an immediate "I can see my business more clearly" moment after connection.

The underlying idea remains aligned with POD and business redesign:

> Can we see enough of the Product, Offer, and Delivery model in ConnectWise to understand how the business is actually working?

Business Visibility is not the final analysis. It establishes the usable business-analysis surface for future Monotorr conversations.

---

## User-Facing Positioning

Business Visibility should feel like:

> Here is what Monotorr can see clearly in your ConnectWise today, what currently limits the picture, and what you can confidently ask next.

It should not feel like:

> Here are 20 things wrong with your ConnectWise configuration.

The block should be concise, practical, owner-focused, and conversational.

If a user wants deeper ConnectWise implementation or cleanup help, Monotorr can say:

> Some of these limitations may be configuration choices rather than problems. If you want help improving or simplifying your ConnectWise setup, let us know and we can connect you with people who do that work every day.

---

## V1 Output Shape

Do not force the user-facing block into five equal sections or a fixed number of checks.

Do not use a 0-100 headline score in V1.

Use a simple overall label such as:

- Strong
- Good
- Limited

Use confidence by area when it helps explain what can and cannot be trusted.

The first block should normally show:

### What We Can See Clearly

Show approximately 3-4 high-value observations.

Examples:

- agreement structure is visible and usable;
- service hours can be measured by client;
- most recorded labor can be assigned a usable member cost;
- recurring agreement products are visible with usable price/cost data.

### What Limits the Picture

Show approximately 3-4 limitations that materially affect business analysis.

Examples:

- some active agreement products are missing Unit Cost or Unit Price;
- some recorded labor cannot be assigned to a costed member;
- project-like work appears mixed into service activity;
- managed-user/device counts are incomplete for normalized comparisons;
- a custom ConnectWise structure cannot be confidently interpreted.

### What You Can Ask Monotorr Now

Show approximately 3-4 useful questions based on the signals actually available.

Examples:

- Which clients consume the most service time?
- Which clients use the most support per managed user?
- Which agreements are missing product cost data?
- Which clients appear expensive to support relative to their recurring agreement?

These prompts should be generated from the actual visibility result, not shown blindly.

### What Would Improve the Analysis

Show approximately 3-4 high-leverage improvements.

Examples:

- complete Unit Cost and Unit Price on active agreement products;
- complete missing member labor cost fields;
- separate project work from service activity where practical;
- improve a missing customer-size denominator used for normalized analysis.

This section should not become a long ConnectWise cleanup list.

---

## Raw Counts and Metrics

Raw counts should be shown only when they help explain a conclusion.

Useful examples may include:

- number of likely active client relationships;
- percentage of active agreement product lines with complete Unit Price and Unit Cost;
- percentage of recent labor hours that can be assigned a usable member cost;
- number of companies with meaningful recent service activity but no clear current agreement relationship.

Counts must be conservative and explainable.

If Monotorr cannot produce a number with reasonable confidence, do not surface it.

A wacky-looking or misleading number damages trust more than omitting a metric.

---

## Interpretation Rule

If Monotorr cannot confidently interpret a ConnectWise structure:

> report the limitation and do not score or infer through it.

Do not invent meaning from custom statuses, custom naming conventions, custom boards, unusual agreement hierarchies, or missing relationships.

Prefer:

> We could not confidently determine X from the available ConnectWise structure.

over a confident but fragile conclusion.

---

## Processing and Retention Principles

Business Visibility runs are ephemeral.

The intended flow is:

1. The end user invokes Business Visibility.
2. Monotorr fetches the required ConnectWise data.
3. Monotorr normalizes and evaluates that data in memory.
4. Monotorr returns a structured result to the LLM.
5. The conversation continues in the LLM.
6. Monotorr does not retain the customer business data or completed block result.

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

- the overall Business Visibility result;
- specific findings;
- company names;
- agreement/product/member/ticket data;
- raw ConnectWise responses;
- the completed structured payload.

Architectural principle:

> Ephemeral customer business data, persistent product telemetry.

---

# Signal Groups

The backend may use deterministic checks grouped around Agreement, Product, Service, Labor, and other useful signals.

These are implementation signal groups, not required user-facing report sections.

The number of checks may change as real ConnectWise environments are tested.

---

## Agreement Signals

### Goal

Determine whether ConnectWise contains a usable agreement model that Monotorr can use to understand recurring client relationships and the structure of the offer.

The business question is:

> Can Monotorr see how recurring client relationships are structured?

### Agreement Hierarchy

Monotorr must understand master/primary agreements and child/sub-agreements.

A client may have:

- one primary/master agreement;
- multiple child/sub-agreements;
- products/additions distributed across the children;
- a $0 master agreement because billable value lives in child agreements or additions.

That structure is valid.

For interpretation:

- count the master/primary relationship as the agreement relationship;
- do not inflate agreement counts by counting every child as a separate client agreement;
- inspect child/sub-agreements when evaluating components;
- note when sub-agreements are being used;
- do not flag a $0 primary agreement merely because value is stored in children/additions.

### Agreement Model Present

Determine whether ConnectWise is actually being used to structure recurring MSP client relationships rather than functioning primarily as a ticketing system while billing lives elsewhere.

Useful signals include:

- primary/master agreements;
- child/sub-agreements;
- agreement additions;
- recurring managed-service components;
- block-time structures;
- per-user billing;
- per-device billing;
- recurring support/base charges;
- recognizable product/service SKUs.

### Active Client Coverage

Do not rely solely on ConnectWise company status because statuses are highly customizable.

Use recent service activity as the primary proxy for an operationally active client.

Initial V1 approach:

- approximately 90 days of recent service activity;
- service tickets and/or service time;
- exclude project activity;
- use a reasonable minimum threshold to avoid classifying trivial administrative activity as a managed-client relationship.

For companies with meaningful service activity, determine whether a current primary/master agreement relationship exists.

Do not automatically treat uncovered companies as failures. Valid exceptions may include T&M clients, administrative relationships, former clients with residual activity, or other non-managed relationships.

### Agreement Type Consistency

Agreement Type is a fixed reportable field and may be useful as a reusable reporting dimension.

Look for whether primary agreements use a reasonably reusable taxonomy.

Do not impose an ideal number of Agreement Types.

A single consistently used Agreement Type may be perfectly valid.

### Agreement Standardization

At a high level, determine whether major Agreement Types show recognizable repeatable patterns or whether every customer appears materially bespoke.

Potential comparison signals include:

- billing model;
- recurring components;
- child/sub-agreement patterns;
- additions/products;
- quantity model;
- pricing structure.

Do not audit every historical SKU or price change.

The purpose is to understand whether the Offer appears repeatable enough to analyze, not to perform agreement archaeology.

### Agreement-Time Attribution

Entering service time directly against agreements can improve agreement-level labor and margin analysis.

However, this is an advanced ConnectWise reporting practice and should not be treated as a readiness failure.

If relevant, surface it as an opportunity:

> Recording service time directly against agreements would improve agreement-level service-consumption and margin analysis.

---

## Product Signals

### Goal

Determine whether Monotorr can identify the recurring products/services being delivered through current agreements and determine what they cost.

Do not scan or grade the entire ConnectWise product/procurement catalog.

The procurement module may contain thousands of historical, one-off, obsolete, hardware, and special-order SKUs that are irrelevant to this block.

Scope Product signals to products/service SKUs attached to current agreement relationships.

### Canonical Structure

The primary business path is:

> Company -> Agreement -> Product

For each relevant product/service SKU on an active agreement or sub-agreement, Monotorr ideally needs:

- identifiable Product/SKU;
- Quantity;
- Unit Price;
- Unit Cost.

### Product Completeness

For each current agreement product/service SKU:

- is Unit Price populated?
- is Unit Cost populated?

If either is missing, that line is incomplete for product-margin analysis.

The central question is:

> Can Monotorr determine both what the customer is being charged and what the product/service costs the MSP?

Useful measures may include:

- percentage of current agreement product lines with both Unit Price and Unit Cost;
- number of affected agreement relationships;
- number of incomplete current product lines.

### SKU Consistency

Where practical, identify whether the same recurring service/product appears to use reasonably consistent SKUs across agreements.

Do not attempt to clean the entire product table.

The purpose is only to determine whether recurring agreement components are structured consistently enough for useful comparison.

---

## Service Signals

### Goal

Determine whether service data is complete and structured enough to measure client service consumption.

This is intentionally not a service-desk maturity audit.

Monotorr should not grade:

- SLA design;
- ticket priority conventions;
- Type/Subtype/Item usage;
- dispatch process;
- escalation workflow;
- ticket closure hygiene;
- queue-management conventions.

The business question is:

> Can Monotorr understand how much service effort each client consumes?

### Canonical Structures

When service work is linked to an agreement:

> Company -> Agreement -> Service Request -> Time

When it is not:

> Company -> Service Request -> Time

Both structures may be usable.

Agreement attribution may improve precision, but it is not mandatory for V1 business visibility.

### Service Activity Capture

Determine whether enough service ticket and time-entry data exists to represent the work being performed.

The goal is not perfect ticket hygiene.

The goal is to determine whether client-level service consumption can be measured with reasonable confidence.

Useful measures may include:

- service hours by client;
- service hours per month;
- service ticket count;
- average time per ticket;
- trend over time.

### Service and Project Separation

Service and project work must never be silently blended.

Service analysis should use service tickets/service time.

Project analysis should use project tickets/tasks/project time.

Some MSPs do project work through service boards instead of the Projects module, especially in T&M-heavy environments.

If project-like work appears mixed into service activity, surface that as a limitation:

> Project-like work appears to be mixed into service activity. Client service-consumption metrics may therefore include project labor.

Do not pretend the resulting service metric is clean if the distinction cannot be made confidently.

### Normalized Service Consumption

Where reliable denominator data exists, Monotorr may normalize service effort using measures such as:

- service hours per managed user;
- service hours per managed workstation;
- service hours per managed device;
- another stable configuration/agreement quantity that reasonably represents customer size.

Do not require every MSP to use the same denominator.

If denominator data is not reliable enough, report the limitation rather than inventing a normalized metric.

---

## Labor Signals

### Goal

Determine whether Monotorr can reliably turn recorded time into labor cost.

The business question is:

> Can recorded labor be assigned to a member with a usable cost?

### Member Cost Availability

Determine whether the members generating recent service and project labor have usable hourly labor cost values in ConnectWise.

Focus on people performing current work, not historical member-record cleanup.

### Usable Cost Values

Look for obvious unusable values such as:

- $0;
- blank/null;
- placeholders;
- clearly implausible values that would materially distort labor analysis.

Do not assume people in similar roles should have identical costs.

### Labor Cost Coverage

Calculate what percentage of recent recorded labor hours comes from members with usable labor cost data.

This is more useful than simply counting populated member records.

### Uncosted Labor

Determine whether any recent service or project time entry cannot be associated with a member who has usable cost data.

If so, surface a direct limitation:

> Some recorded labor cannot be assigned a usable labor cost because the associated member is missing cost data. Complete the member cost fields in ConnectWise to improve labor-cost and profitability analysis.

Useful outputs may include:

- percentage of recent labor hours with usable member cost coverage;
- count of time entries that cannot be costed;
- count of members responsible for uncosted labor.

Avoid unnecessary employee-level detail in the summary block unless the user chooses to investigate.

---

# Business-Analysis Confidence

Business Visibility should communicate confidence rather than false precision.

The broader analysis may combine signals such as:

### Revenue / Product Economics

> Company -> Agreement -> Product -> Quantity / Unit Price / Unit Cost

### Service Labor

> Company -> Service Request -> Time -> Member -> Hourly Cost

Or, when available:

> Company -> Agreement -> Service Request -> Time -> Member -> Hourly Cost

Project activity remains separate.

These relationships may allow Monotorr to provide useful lightweight profitability indicators.

Monotorr must not imply accounting-grade precision where the source data does not support it.

Useful language includes:

- High confidence
- Good confidence
- Limited confidence
- Not enough data

Example:

> Labor-cost analysis: High confidence. Nearly all recent recorded labor can be assigned to members with usable hourly cost data.

Example:

> Product-margin analysis: Limited confidence. Several active agreement product lines are missing Unit Cost.

The product should distinguish:

- what can be calculated confidently;
- what can be estimated;
- what should not yet be claimed.

---

# Development and Testing Approach

Business Visibility should be built as a reusable analysis engine first, then exposed through the MCP tool and visual block.

Do not make the analysis logic dependent on ChatGPT or any other specific LLM client.

Preferred shape:

```
ConnectWise
   |
shared collectors
   |
normalized data
   |
Business Visibility analyzer
   |
structured result
   |-- local/internal test harness
   |-- MCP tool
       |-- ChatGPT / Claude / Copilot / other MCP clients
```

## Development Harness

Create a local/internal development harness that can run the Business Visibility analysis without requiring the final conversational UI.

This allows:

1. build the collector/analyzer;
2. run it against test fixtures;
3. run it against a real pilot ConnectWise environment;
4. inspect the structured result;
5. identify misleading counts, ambiguous structures, or missing signals;
6. refine the logic;
7. repeat;
8. expose the stabilized engine through the MCP tool and visual block.

The harness is development tooling, not a separate application.

## Fixture Testing

Add deterministic fixtures for known scenarios, for example:

- strong agreement structure;
- minimal/no agreement structure;
- master/sub-agreements;
- $0 master with value in children/additions;
- missing Unit Price;
- missing Unit Cost;
- inconsistent recurring SKUs;
- service time linked to agreements;
- service time linked only to company;
- project work cleanly separated;
- project-like work mixed into service;
- missing member labor cost;
- incomplete customer-size denominator.

Fixture tests prove the logic behaves consistently.

## Live Pilot Runs

Fixture testing is necessary but not sufficient because ConnectWise is highly customizable.

Run the development harness against real pilot environments before locking V1 behavior.

Live pilot runs are expected to reveal assumptions that do not hold in real data.

---

# Discovery During Implementation

The first implementation will be tested against real ConnectWise environments.

New edge cases, ambiguous structures, and useful signals are expected to emerge.

V1 should favor conservative interpretation and visible limitations over increasingly complex inference.

Expected discoveries may include:

- sub-agreements behaving differently than expected;
- endpoints not exposing a field assumed to be available;
- apparently useful metrics producing misleading numbers;
- custom structures that cannot be safely interpreted;
- a simpler signal proving more useful than a planned one.

When this happens:

- do not force the original design;
- document the edge case;
- simplify the interpretation where possible;
- prefer an explicit limitation over fragile logic;
- update fixtures so the behavior remains tested.

This is an intentional part of building the block, not a failure of the design.

---

# Future Block Pattern

Business Visibility should establish the reusable pattern for future Monotorr blocks:

1. Run deterministic read-only analysis against live ConnectWise data.
2. Return a concise structured visual summary.
3. Tell the owner what Monotorr can see clearly.
4. State what limits the analysis.
5. Suggest useful questions based on the actual data.
6. Suggest a small number of improvements where better structure would materially improve visibility.
7. Continue exploration conversationally through the LLM.
8. Do not retain the customer business result after delivery.

Future blocks can reuse this architecture without forcing every block into the same visual sections or number of checks.
