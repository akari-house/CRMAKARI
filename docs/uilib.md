# AKARI CRM UI Library

## Purpose

This document is the source of truth for visual and interaction design across AKARI CRM. It translates the strongest ideas from modern workflow products into an AKARI-specific system rather than copying any external interface.

The system should feel:

- operational, calm and premium
- information-dense without looking crowded
- dark, layered and spatial
- unmistakably AKARI through pink, yellow and flower-inspired accents
- fast enough for daily CRM work

## Design principles

1. **One clear action per surface.** Every panel, card and modal must have an obvious primary action.
2. **Relationship context first.** Leads, contacts, partners, services and invoices should always show the relationship owner, next action and current state.
3. **Progress is visual.** Lifecycle, task, invoice and service states must be readable without opening a record.
4. **Dense, not cramped.** Compact controls are allowed, but text, spacing and hierarchy must remain clear.
5. **No decorative ambiguity.** Glows, gradients and lines must indicate state, direction or emphasis.
6. **Every component has complete states.** Default, hover, focus, active, selected, disabled, loading, success, warning, error and empty.

## Foundations

### Colour tokens

```css
--ak-bg-0: #07090d;
--ak-bg-1: #0c0f15;
--ak-surface-1: #11151d;
--ak-surface-2: #171c25;
--ak-surface-3: #202631;
--ak-border: rgba(255,255,255,.09);
--ak-border-strong: rgba(255,255,255,.17);
--ak-text: #f7f8fb;
--ak-muted: #a3a9b5;
--ak-subtle: #707887;
--ak-pink: #f04f87;
--ak-yellow: #ffd33d;
--ak-green: #56df86;
--ak-teal: #55d7df;
--ak-red: #ff6e7c;
--ak-blue: #6d9dff;
```

Pink and yellow identify AKARI. Green and teal represent successful operations, active flows and completed progress. Red is reserved for destructive or failed states.

### Radius

```css
--ak-radius-xs: 8px;
--ak-radius-sm: 10px;
--ak-radius-md: 14px;
--ak-radius-lg: 18px;
--ak-radius-xl: 24px;
```

### Spacing

Use a 4px base rhythm. Preferred steps: 4, 8, 12, 16, 20, 24, 32, 40.

### Typography

- UI font: Inter or system sans-serif
- Headings: 600–750 weight
- Labels and metadata: 500–700
- Avoid oversized headings inside operational views
- Tabular numerals for money, percentages and dates

## Surfaces

### App shell

- Fixed or sticky left navigation
- Sticky top bar with search and quick-create
- Main content uses a maximum readable width where appropriate
- Full-width workflow or board views may extend edge to edge

### Panels

Panels use layered dark surfaces, a restrained border and optional inner highlight.

Variants:

- default
- raised
- interactive
- selected
- success
- warning
- error

### Workflow canvas

The workflow canvas uses a dotted grid background. Connectors indicate state:

- neutral: muted grey
- active: AKARI pink
- successful: green to teal
- waiting: yellow
- failed: red

The canvas should only be used for meaningful sequences such as lead lifecycle, service delivery, approvals or campaign execution.

## Components

### Buttons

Variants:

- primary: pink emphasis
- secondary: dark surface
- success: green
- warning: yellow
- destructive: red
- ghost: transparent
- icon-only

States:

- default
- hover
- focus-visible
- active
- loading
- disabled

### Inputs

Includes text, search, select, date, money, percentage, textarea and combobox.

Required states:

- default
- focused
- populated
- invalid
- disabled
- read-only
- loading suggestions
- no results

### Pills and badges

Use pills for compact state communication, not decoration.

Examples:

- Lead
- Client
- Partner
- Overdue
- Paid
- Waiting
- Referral due
- Missing X
- Missing Telegram

### Record cards

Required areas:

- identity/avatar
- title and subtitle
- lifecycle/status
- owner
- next action or due date
- optional financial amount
- optional quick actions

### Workflow nodes

Node variants:

- source
- action
- decision
- approval
- wait
- message
- meeting
- conversion
- success
- failure
- exit

Node states:

- idle
- configured
- active
- waiting
- completed
- failed
- disabled
- selected

### Side inspector

A right-side inspector may show:

- editable record details
- draft message or invoice preview
- activity history
- projected outcome
- guardrails
- validation errors

It must not hide the primary action.

### Tables

Tables must support:

- sticky header
- row hover
- selected row
- inline status
- empty state
- loading skeleton
- sorting
- filters
- bulk selection
- compact and comfortable density

### Modals and drawers

Use a modal for focused creation or confirmation. Use a drawer for ongoing inspection and editing.

All overlays need:

- visible title
- explanation when necessary
- close action
- cancel action
- single primary action
- loading and error handling

### Empty, loading and error states

Every data surface must define:

- first-use empty state
- filtered empty state
- loading skeleton
- partial failure
- full failure
- recovery action

## CRM patterns

### Lead lifecycle

A lead may progress through:

```text
Lead → Prospect → Opportunity → Client / Partner → Active Service → Renewal / Completed
```

The same relationship record remains the source of truth. Conversion creates connected operational records rather than duplicates.

### Referral attribution

Always show:

- introducer
- percentage or fixed amount
- revenue basis
- estimated reward
- due status
- payment status

### My Day

The daily workspace should prioritise:

- overdue follow-ups
- tasks due today
- leads with no next action
- services ending soon
- invoices due
- referral rewards due

## Accessibility

- Minimum AA contrast for text
- Visible focus ring on every interactive control
- Do not rely on colour alone
- Minimum 40px pointer target where practical
- Keyboard support for navigation, dialogs and forms
- Motion must respect reduced-motion preferences

## Usage rules

- Do not introduce new colours without updating this document.
- Do not create a new button, badge or panel style when an existing variant works.
- New components must define all states before production use.
- CRM pages should import `public/assets/uilib.css` and use the `ak-` component classes.
- The reference gallery is available at `/uilib.html`.

## External reference

Visual inspiration was drawn from the user-provided Qolly workflow design on Dribbble, especially its layered dark surfaces, compact nodes, stateful connectors, side inspector and dense operational layout. AKARI colours, product structure and interaction rules remain the source of truth.