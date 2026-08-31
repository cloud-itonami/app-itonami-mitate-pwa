# Business Model: mitate (見立て) — advisory-tier self-care PWA

## Classification

- Repository: `cloud-itonami/app-mitate-pwa`
- Product: patient-facing PWA for chronic nasal congestion, 5-condition triage,
  **advisory tier only** (`wrangler.jsonc` → `APP_DESCRIPTION`)
- Phase: **R0 scaffold.** The Worker returns `503 MitateR1PhaseGateLocked` for
  every route until `MITATE_R1_PHASE_GATE` is set to a non-`locked` value
  (`src/app.ts`). Nothing is served, nothing is metered, nobody is billed.
- Governing ADRs: ADR-2605260100 (mitate master charter), ADR-2605260200 (R1
  self-care advisory PWA)

## Customer — the patient is not the payer

Three candidate customers, none of them the person using the app:

- **宗教法人 operators** running mitate as care infrastructure for adherents.
  This is the charter case: the app exists because a religious corporation
  wanted a way to answer "my nose has been blocked for three months" without
  either pretending to diagnose or saying nothing.
- **耳鼻咽喉科 clinics** that want a structured pre-visit intake (per-condition
  top-7 sign signature + medication history + trigger diary) instead of
  reconstructing it in the exam room.
- **産業医 / occupational health** settings, where chronic congestion shows up
  as presenteeism and the useful output is an escalation recommendation, not a
  diagnosis.

The patient is deliberately outside the payment relationship. See *Why the
adherent tier is ¥0 and will stay ¥0* below — that is a constraint, not a
promotion.

## Problem

Chronic nasal congestion has five overlapping causes that present almost
identically to the person experiencing them. The fifth — **rhinitis
medicamentosa**, rebound congestion from prolonged OTC vasoconstrictor use — is
*caused by* the self-treatment the other four invite. That is why this repo has
a `/medication-audit` route and a 3-tier withdrawal protocol at all.

The available answers today are a symptom checker that outputs a specialty
name, or nothing. Neither carries an emergency screen that cannot be bypassed,
and neither leaves the operator a record of what was said to whom.

## Offer

- disclaimer-first flow (G3): `/triage` and `/medication-audit` 303 back to
  `/disclaimer` until a triple acknowledgement is present
- emergency screen that is **architecturally** un-bypassable (G5): `/intake` →
  `/emergency_screen` always; POST to `triageVerdict` returns
  `405 G5InvariantBlocked`
- escalation recommendation (which 診療科, how urgently) — never a diagnosis
- self-care environmental advisory
- medication audit for the rebound-congestion path
- notification limited to three urgency-only channels (G11): `emergency-ack`,
  `appointment-reminder`, `ae-followup`
- substrate boundary (G14): every patient-data write proxies through the SDK
  endpoint; the patient-facing Worker holds no direct MST / IPFS / L2 surface

The promise is not accuracy. The promise is **that the escalation path cannot be
skipped, and that the operator can prove what the tool said.**

## The regulatory ceiling is what fixes the price

Under 薬機法, a program is a regulated 医療機器プログラム when it both has
医療機器の目的性 (a diagnostic or therapeutic purpose) and could affect
「生命及び健康」 if it fails to work as intended. Programs whose impact is
「人の生命及び健康に影響を与えるおそれがほとんどないもの」 are excluded.
(厚生労働省「医療機器プログラムについて」, and the linked
「プログラムの医療機器該当性に関するガイドライン」, 令和5年3月31日 一部改正版 —
see Sources.)

Two consequences that the price book has to obey:

1. **The advisory tier sells because it is *below* the device threshold.** The
   moment an output functions as a diagnosis, the product is a 医療機器プログラム
   and needs 承認 or 認証. That is exactly the R3 gate the README already names
   (「薬事/医療機器手続き」). Until then, **accuracy is not a purchasable
   feature**, and no plan may be written as though it were.
2. **If the operator is a 医療機関, its site is 広告規制 territory** (医療法
   第6条の5 / 第6条の7, and 「医療広告規制におけるウェブサイト等の事例解説書
   （第６版）」令和8年3月30日). Comparative and superlative claims about the tool
   are not available to that operator, which removes the usual SaaS pitch.

This is why there is no competitor price in this document. The nearest products
price a *diagnostic-feeling* output; mitate refuses to produce one. A benchmark
against them would be a benchmark against a different good.

**What is not measured here, stated as unmeasured:** no competitor's revenue
split (patient / clinic / pharma) is cited, because no primary source for one
could be fetched. Absence of a figure here is absence of a verified figure, not
evidence that the market is free.

## Why the adherent tier is ¥0 and will stay ¥0

The app's first job on the intake path is the G5 emergency screen. A price —
any price, including a trial wall or an account requirement — that a person has
to get past before that screen runs is a price standing between someone and an
ER routing instruction. There is no revenue number that survives that sentence.

The same reasoning removes two units that would otherwise be obvious:

- **Per-patient seats are impossible and undesirable.** Undesirable for the
  reason above; impossible because R1 derives a 30-day rotating pseudonym DID in
  the browser, so there is no stable person to count. A seat price would require
  building the identity surface the design deliberately does not have.
- **Per-notification pricing is forbidden.** G11 exists to stop the app from
  finding reasons to contact people. A price per notification would pay the
  operator to send them. **The billing unit must not create the incentive a
  constitutional gate exists to remove** — that rule is enforced in
  `tests/pricing-invariants.test.ts`, not just asserted here.

## Revenue — what may be charged, and on what unit

Chargeable to the **operator**, never the adherent:

| Unit | What it describes | Available |
|---|---|---|
| managed tenancy (flat monthly) | the operator does not run the Worker itself | after the gates below |
| `advisory-session` | one completed disclaimer → intake → emergency-screen → verdict cycle | only once a meter exists |
| `escalation-handoff` | one G6 human-review referral produced | only once a meter exists |

Both usage units describe **load**, and both are auditable by the operator
against their own records — a number a customer cannot check from their own side
is a number that gets disputed at renewal.

Neither is metered today. `pricing.json` therefore declares
`meteredDimensions: []` and prices no usage at all. A month that was not
measured cannot be measured afterwards; a price can always be chosen later.

## Funnel

1. **Fork / self-host** — Apache-2.0 + Charter Compliance Rider. An operator
   runs it for one congregation or one clinic. Free, and stays free.
2. **Baseline attestations** — the operator cannot deploy anything that answers
   until the R1 gate opens (8 `silenMitateReview` baselines + 5 per-condition
   Bayesian priors, with licensed-MD and emergency-medicine co-signs). This is
   the real cost of entry and it is not payable in money.
3. **Managed tenancy** — for operators who want the attestations honoured and
   the Worker run for them.
4. **R2 / R3** — diagnostic ordering, treatment routing, and the SLIT/ESS
   planners are behind separate gates and are *not* in scope for any price today.
   The Worker 503s those lexicons by name.

## Gates that must all be met before anyone is charged

Mirrored as machine-checkable entries in `pricing.json` → `billingGates`:

1. `r1-phase-gate` — `MITATE_R1_PHASE_GATE` is no longer `locked`
2. `metering-exists` — the Worker actually counts `advisory-session`
3. `device-classification` — 該当性 settled for the advisory tier (PMDA SaMD
   相談 or a documented self-assessment on file)
4. `operator-terms` — terms of service and 特定商取引法 disclosure for the
   operating entity
5. `advertising-review` — if the operator is a 医療機関, the surface reviewed
   against the 事例解説書
6. `payment-rail` — a payment rail exists at all

Every gate is `met: false` today. Every plan is `status: "proposed"`. The
numbers exist so they can be argued with, not because anyone may be billed
from them.

## Sources

Every URL below was fetched on 2026-08-31 and returned HTTP 200. Quoted
Japanese comes only from pages whose text was actually read; the two PDFs are
cited as the authoritative documents but are **not quoted**, because their text
could not be extracted at fetch time.

| Source | Used for | URL |
|---|---|---|
| 厚生労働省「医療機器プログラムについて」 | the two-condition 該当性 test and the 「影響を与えるおそれがほとんどないもの」 exclusion (read) | <https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/0000179749_00004.html> |
| 「プログラムの医療機器該当性に関するガイドライン」（令和5年3月31日 一部改正） | authoritative text of the 該当性 test (cited, not quoted) | <https://www.pmda.go.jp/files/000240233.pdf> |
| PMDA「プログラム医療機器の薬事開発・承認申請に関する手引き」 | what the R3 承認 path costs in process (cited, not quoted) | <https://www.pmda.go.jp/files/000274829.pdf> |
| PMDA「プログラム医療機器」 | SaMD consultation route | <https://www.pmda.go.jp/review-services/drug-reviews/about-reviews/devices/0048.html> |
| 厚生労働省「医療広告規制について」 | 医療法第6条の5 / 第6条の7 and 「事例解説書（第６版）」令和8年3月30日 (read) | <https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/kenkou_iryou/iryou/kokokukisei/index.html> |

Regulatory citations are a snapshot of 2026-08-31 and are not legal advice. The
`device-classification` and `advertising-review` gates exist precisely because
this document is not the thing that settles either question.
