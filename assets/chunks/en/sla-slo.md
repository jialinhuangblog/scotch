---
title: "SLA, SLO, SLI"
slug: sla-slo
brief: "How the number of nines converts into downtime per year, and how a team spends that time as a budget."
date: 2026-09-25
---

# SLA, SLO, SLI

> A deployment goes wrong and the service is down for 20 minutes. Is that serious?

## How long each number of nines allows

Availability written as a percentage is hard to feel. Converted into time, it is easier to judge. A year is 31,557,600 seconds; multiply by the allowed downtime ratio and you get how long the service can be down per year.

| Availability | Common name | Downtime per year | Downtime per year (seconds) | Downtime per month |
|---|---|---|---|---|
| 99% | two nines | about 3.65 days | 315,576 | about 7.3 hours |
| 99.9% | three nines | about 8.8 hours | 31,558 | about 44 minutes |
| 99.99% | four nines | about 53 minutes | 3,156 | about 4.4 minutes |
| 99.999% | five nines | about 5 min 16 sec | 316 | about 26 seconds |
| 99.9999% | six nines | about 32 seconds | 32 | about 2.6 seconds |

Each extra nine cuts the allowed downtime to one tenth. Back to the 20 minutes at the start: with a 99.99% target, that one incident uses 38% of the year's allowance; with a 99.999% target, that one incident is already 3.8 times the year's allowance.

## How SLI, SLO and SLA differ

- **SLI** (Service Level Indicator): the number actually measured, for example successful requests were 99.97% this month. Usually computed from [metrics](chunk://metrics).
- **SLO** (Service Level Objective): the target the team sets for itself, for example 99.99%. Missing it costs no money, but the team stops to deal with it.
- **SLA** (Service Level Agreement): the promise written into the contract with customers; missing it means paying credits. Usually set looser than the SLO, so there is still a buffer when the SLO is missed.

HA (High Availability) is a different thing: the design done to reach the target, such as redundant machines and automatic failover. It is not a number itself.

## error budget

With an SLO of 99.99%, a year has about 53 minutes available for downtime. Google's SRE book treats those 53 minutes as a budget: while some is left, deploy and experiment as usual; once it is used up, pause new features and put the people back on stability.
