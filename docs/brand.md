# Monotorr — Brand & Console UI Guidelines

> Version: 1.0 · October 2026  
> Purpose: Design reference for Codex when building or modifying the Monotorr customer console, especially ConnectWise API configuration and onboarding.  
> Scope: Visual language, typography, interface behavior, copy, and implementation guardrails. This file is not an authorization, security, or API specification.

## 1. Brand direction

**Monotorr**  
**Your ConnectWise data. Your AI.**

Monotorr gives MSP owners a straightforward, read-only connection between ConnectWise Manage and their preferred AI tools. The product should feel trustworthy, calm, modern, capable, and slightly technical — never flashy or unnecessarily complex.

Design keywords: **bold, clean, editorial, practical, slightly technical, and modern without generic SaaS styling.**

Core principle: **Make the next step obvious.** The interface should explain what is needed, why it is needed, and whether it worked.

The brand has editorial roots, but this is a *working console*: prefer compact, useful UI over landing-page drama. Treat MSP Playbook as a related visual influence, not as the Monotorr product identity. Do not import its sticky-note motifs, illustrations, or colors by default.

## 2. Typeface decision

Use **two typefaces only**:

1. **Fira Sans** — *all interface text, headlines, navigation, labels, buttons, and guidance.*
2. **Fira Code** — *technical identifiers, endpoints, short code snippets, and values where fixed-width alignment helps.*

**Do not use Scandia Web.** It is not part of the approved console typography. Do not introduce a substitute display typeface unless this file is explicitly revised. Use Fira Sans weights and spacing to create character.

Fira Sans and Fira Code are available as free/open-source fonts. Keep the corresponding license notices if self-hosting font files.

### Font installation

Prefer existing project font-loading conventions. If there is no existing convention, load only the required weights from Google Fonts or self-host font assets, consistent with project policy. Provide sensible fallbacks and avoid layout shifts.

```css
/* Example remote loading; use self-hosted files if project policy requires it. */
@import url('https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;500;600&family=Fira+Sans:wght@400;500;600;700;800&display=swap');

:root {
  --font-sans: 'Fira Sans', ui-sans-serif, system-ui, sans-serif;
  --font-mono: 'Fira Code', ui-monospace, SFMono-Regular, Consolas, monospace;
}

body { font-family: var(--font-sans); }
code, pre, .technical-value { font-family: var(--font-mono); }
```

Do not set all numbers or form fields in Fira Code. Use it intentionally, not decoratively.

## 3. Typography scale

### Product console (default)

| Element | Desktop | Mobile | Weight | Line height | Notes |
| --- | --- | --- | --- | --- | --- |
| Page title / H1 | 32–40px | 28–32px | 700 | 1.12–1.2 | Fira Sans; sentence case |
| Section title / H2 | 24–28px | 22–24px | 700 | 1.2–1.3 | Clear sectional hierarchy |
| Subsection / H3 | 18–20px | 18px | 600–700 | 1.3 | Short, functional |
| Body | 15–16px | 16px | 400 | 1.5–1.65 | Comfortable reading |
| Navigation | 14–15px | 14–15px | 500–600 | 1.35 | Brief labels |
| Field label | 14px | 14px | 600 | 1.4 | Always visible |
| Helper / secondary text | 13–14px | 13–14px | 400 | 1.45–1.55 | Never the only instruction |
| Buttons | 14–15px | 14–15px | 600 | 1.2 | Clear verbs |
| Technical value | 13–14px | 13–14px | 400–500 | 1.45 | Fira Code, as needed |
| Status / metadata | 12–13px | 12–13px | 500–600 | 1.4 | Use contrast and labels |

### Marketing/editorial contexts (not the console default)

On a landing page, Fira Sans may use H1 **48–64px desktop / 36–44px mobile**, H2 **32–40px desktop / 28–32px mobile**, with 700–800 weight. Do **not** use that scale inside forms, dashboards, or setup flows.

Headline example:

```css
.page-title {
  font-family: var(--font-sans);
  font-weight: 700;
  font-size: clamp(1.75rem, 2.6vw, 2.5rem);
  line-height: 1.15;
  letter-spacing: -0.025em;
}
```

Use sentence case. Prefer **Connect your ConnectWise environment** over **CONNECTWISE API CONFIGURATION**. Avoid artificial uppercase text except short data labels where helpful.

## 4. Color policy

**Do not invent a final Monotorr color palette based on this document.** Typography is established here; product color tokens must come from the existing Monotorr codebase, brand assets, or a separately approved palette.

Until such a palette exists:

- Favor a neutral light theme: off-white/white canvas, charcoal text, restrained gray surfaces.
- Use *one* primary action color from existing product tokens; do not import MSP Playbook blue or sticky-note colors automatically.
- Reserve status colors for actual meaning: connected/success, needs attention/warning, failed/error, and informational states.
- Meet WCAG AA contrast expectations for normal text (4.5:1) and non-text UI indicators (3:1) where applicable.
- Support visible keyboard focus and never convey status using color alone.
- Do not hardcode speculative hex colors throughout components. Define semantic tokens centrally.

Suggested **semantic token names**, not palette values:

```css
:root {
  --color-background: /* approved product token */;
  --color-surface: /* approved product token */;
  --color-text: /* approved product token */;
  --color-text-muted: /* approved product token */;
  --color-border: /* approved product token */;
  --color-primary: /* approved product token */;
  --color-primary-contrast: /* approved product token */;
  --color-success: /* approved product token */;
  --color-warning: /* approved product token */;
  --color-danger: /* approved product token */;
  --color-focus: /* approved product token */;
}
```

The above is an illustrative naming contract, **not runnable CSS** until real values are assigned.

## 5. Layout and component style

- Prioritize **one clear primary action** per screen or step.
- Use a consistent spacing scale (for example 4/8/12/16/24/32px), with generous separation between logical groups.
- Center complex setup forms within a reasonable width, approximately **640–800px**, rather than stretching them edge to edge.
- Use a wider layout only for meaningful tables, multi-column comparisons, or account overviews.
- Prefer typography, spacing, and subtle separators over a page filled with cards.
- Use cards only when they clarify a task or group related controls. Avoid cards nested within cards.
- Keep borders, radii, and shadows understated and consistent with existing product components.
- Avoid gratuitous gradients, glassmorphism, decorative charts, animated illustrations, or excessive icons.
- Use simple, familiar icons only when they improve scanning or usability.
- Keep console navigation compact; do not turn the settings interface into a dashboard without a user need.
- Respect responsive behavior: stack form controls on narrow screens and avoid horizontal scrolling in the main setup flow.

## 6. ConnectWise API configuration flow

The configuration experience must feel like a short, guided setup rather than a developer control panel.

**Indicative information architecture** (adapt to the actual implemented flow and approved technical requirements):

1. **Connect** — Explain what Monotorr does, identify the ConnectWise connection, and show prerequisites.
2. **Configure** — Collect the necessary server URL, API credentials, and other required fields, with clear examples and context.
3. **Test connection** — Show the connection check and a specific outcome.
4. **Ready** — Confirm what is connected and show the next useful action, such as opening setup guidance or running the first assessment.

UX rules:

- Tell users **why a value is required** next to the field, in plain language.
- Use persistent labels, concise helper text, and realistic input examples.
- Mark required and optional fields clearly.
- Group server/account details separately from credentials.
- Never expose stored secret values after initial entry. Mask secret inputs, do not log or reveal them in error messages, and offer a safe replacement flow.
- Provide a clear **Test connection** action and distinguish *untested*, *testing*, *connected*, and *needs attention* states.
- Preserve nonsecret inputs after validation errors when safe.
- Make errors actionable: what failed and what the user can check, without exposing sensitive response details.
- Do not claim that a tenant is connected until the application actually confirms it.
- Avoid dead-end success screens. End setup with a useful next step.

These design guidelines do **not** authorize permission changes, write access, background remediation, or changes to tenant isolation. Monotorr's ConnectWise MCP offer is **read-only**; technical enforcement comes from the system's security and product specifications, not from interface copy.

## 7. Copy and tone

Speak to a capable MSP owner, not a developer who enjoys configuring infrastructure.

Voice: **plainspoken, confident, concise, useful, human**.

Prefer:

- **Connect your ConnectWise environment**
- **Test connection**
- **Your connection is working**
- **We couldn't verify the connection. Check the server URL and credentials, then try again.**
- **Run your first assessment**
- **Read-only access. Monotorr cannot make changes to your ConnectWise data.** (Use only if technically verified for the relevant flow.)

Avoid:

- **Initiate API credential authentication sequence**
- **Connection operationalized successfully**
- **An unexpected exception has occurred** without a useful next step
- Claims like **100% secure**, **zero risk**, or **automatically fixes your data**

Keep calls to action short, direct, and conversational. Prefer verbs such as **Connect**, **Test**, **Continue**, **Save**, **Retry**, and **Run**. Do not use cute names for essential controls.

## 8. Forms, data, and technical details

Use **Fira Sans** for form labels, inputs, help text, navigation, and buttons. Use **Fira Code** selectively for endpoints, identifiers, and code-like examples.

```css
.form-label {
  font-family: var(--font-sans);
  font-size: 0.875rem;
  font-weight: 600;
}

.button {
  font-family: var(--font-sans);
  font-weight: 600;
  letter-spacing: -0.01em;
}

.endpoint, .technical-value {
  font-family: var(--font-mono);
  font-variant-ligatures: none;
  overflow-wrap: anywhere;
}
```

- Show meaningful status with **text + icon/color**, not color alone.
- Use readable labels instead of unexplained API property names.
- Use tabular numerals if numeric columns need alignment, rather than forcing every table cell into Fira Code.
- Avoid giant result tiles for ordinary setup state.
- Use monospace for copyable code and identifiers, not lengthy explanations.
- Provide accessible copy controls for long values only when appropriate and safe (never casually surface credentials).
- Ensure validation messages can be announced to assistive technologies; ensure accessible labels and focus order.

## 9. Example screen structure

```text
Monotorr                                 [Account]

Connect your ConnectWise environment
Connect read-only so you can explore your ConnectWise data with AI.

Connection details
[Server URL                                 ]
 Example: https://...   (use the actual supported format)

[Company / site identifier                  ]
 Enter the identifier required by this connection.

API credentials
[Public key                                 ]
[Private key                                ]  [Show/Hide]
 Credentials are used to verify your connection.

[ Test connection ]

Connection status: Not tested

----------------------------------------------------
Need help?  View setup instructions
```

The fields above are **illustrative**, not a definitive API schema. Codex should derive actual fields, validation, state transitions, and connection testing from the application's implemented requirements. Do not invent required inputs.

## 10. Implementation instructions for Codex

When applying this document:

1. **Inspect the existing app first**: identify its components, routes, CSS strategy, design tokens, accessibility conventions, and authentication boundaries.
2. **Preserve architecture and behavior**: do not alter API contracts, credential storage, validation logic, permission scope, tenant isolation, or authentication merely to implement a visual redesign.
3. **Standardize typography** to Fira Sans / Fira Code. Remove Scandia Web references and unnecessary alternative families from the console.
4. **Reuse existing components** before creating new ones. Centralize font families, font sizes, spacing, and semantic colors into tokens.
5. **Improve the connection experience** using the guidance above, while retaining working features and state handling.
6. **Check all states**: initial, incomplete, validation error, testing, success, failure, disconnected, and reconnecting where applicable.
7. **Check viewport behavior**: desktop, tablet, and mobile. Verify wrapping, long endpoints, errors, focus visibility, and controls.
8. **Do not invent brand colors**. If the project lacks approved color tokens, use its current neutral palette and flag the pending brand-color decision in the implementation summary.
9. **Run available tests and build checks**, and provide a concise summary of what changed and what still needs manual QA.
10. **Avoid scope creep**: a styling task must not turn into new administrative features, a dashboard, or an auth refactor.

## 11. Design acceptance checklist

- [ ] Scandia Web is absent from console styling.
- [ ] Fira Sans drives headlines, content, controls, and navigation.
- [ ] Fira Code appears only in suitable technical contexts.
- [ ] Page and section headings are in sentence case and appropriately scaled for a console.
- [ ] Each setup screen or step has an obvious primary action.
- [ ] Form controls have visible labels, helpful messages, and clear states.
- [ ] Connection feedback is understandable and actionable.
- [ ] Secret values are not inadvertently rendered, persisted in logs, or exposed in errors.
- [ ] Read-only positioning is accurate and does not exceed actual technical guarantees.
- [ ] UI remains responsive and keyboard-accessible.
- [ ] Approved Monotorr color tokens are reused rather than guessed.
- [ ] Existing functionality, tenant isolation, and authentication are unchanged unless separately specified.
- [ ] Build/tests pass or remaining issues are explicitly reported.

## 12. Governing rule

**When choosing between more decoration and more clarity, choose clarity.**

Improve typography, hierarchy, whitespace, field labels, error messages, and next-step guidance before adding new components or visual effects.
