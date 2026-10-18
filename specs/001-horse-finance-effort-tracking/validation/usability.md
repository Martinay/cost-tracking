# Usability study protocol

## Status: NOT EXECUTED

No participants have been recruited or observed. There are no completion counts, timing results, or interpretation results in this record.

## Study setup

Recruit 20 people who have not used the application. Use the same isolated synthetic account state, browser build, screen size, and task wording for each session. Do not use real financial data, production accounts, WorkOS credentials, or participant names in the application. Explain the task and obtain consent before starting. Assign a random participant code such as `P01`; keep no identity-to-code key in this repository. Do not record audio/video unless the participant separately agrees and a protected retention process is arranged.

Use a timer and neutral observation sheet. Do not coach or point to controls. A clarification that gives task-specific direction counts as assistance. Record browser, viewport, zoom, start/end timestamps, completion, assistance, blocker descriptions, and each answer. Avoid copying free-form text that could contain identifying information.

## Standard participant task

Read these instructions verbatim:

> You are setting up a private horse ledger. Add the horse named Willow. Record an expense of €10.01 and split it equally across your two horses. Then look at the income list and explain which income is pending, which is realized, and which was skipped. Tell me which amounts should be included in the realized report.

After the task, ask the participant to explain the three income states in their own words without revealing the expected answer first. Use shuffled synthetic examples in the account so the task does not teach a fixed screen position.

## Session record template

| Participant code | Browser / viewport / zoom | Unaided first-horse + split-expense completion (yes/no) | Elapsed time | Correctly distinguishes all three income states (yes/no) | Assistance / blocker notes, anonymized |
|---|---|---|---:|---|---|
| P01 |  |  |  |  |  |
| … |  |  |  |  |  |
| P20 |  |  |  |  |  |

## Acceptance and follow-up

Pass requires at least 18 of 20 participants to complete the first-horse and split-expense tasks unaided within five minutes, and at least 18 of 20 to correctly distinguish pending, realized, and skipped income and explain inclusion in the realized report. Record observed defects without personal details. Fix each blocking defect under regression coverage, then repeat the same study with new participants. Attach only anonymized, aggregate results after the sessions occur. Until then, SC-001/SC-007 usability acceptance remains open.
