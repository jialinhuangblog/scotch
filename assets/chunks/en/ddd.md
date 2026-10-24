---
title: "DDD"
slug: ddd
brief: "From Eric Evans's blue book. In practice teams usually keep the strategic layer and skip some of the tactical patterns."
article: ddd-textbook-vs-real
date: 2026-06-14
updated: 2026-07-20
revisions: 1
---

# DDD

Domain-Driven Design, a design method that makes code follow the business. The nouns in the code are the business's own words, and the system's boundaries match the business's boundaries. The problem it solves: once a system grows, business rules scatter across controllers, services, and SQL, changing one rule means digging through five places, and nobody can say which copy is the right one. Eric Evans put the method into a whole book in 2003 ("Domain-Driven Design: Tackling Complexity in the Heart of Software", blue cover, known as the blue book), and the eight concepts below all come from it.

## Eight core concepts

| Concept | What it solves |
|---|---|
| Ubiquitous Language | Business, code, and DB all use one vocabulary; agree with the business on "void" and the code calls it `void` too, no translation in between |
| [Bounded Context](chunk://bounded-context) | The same word means different things in different subdomains; each gets its own model |
| [Aggregate Root](chunk://aggregate) | The representative of a group of entities, responsible for keeping invariants |
| [Repository](chunk://repository-pattern) | The domain defines the interface, infra provides the implementation |
| [Domain Service](chunk://domain-service) | Pure business functions, zero I/O |
| [Application Service](chunk://application-service) | Orchestrates domain services + repositories |
| [Domain Event](chunk://domain-event) | Business events passed as events |
| [Anti-Corruption Layer](chunk://anti-corruption-layer) | A translation layer toward external systems |

## Textbook vs practice

At first the instinct is to follow all of it. After enough practice you learn which parts do not work well and drop 2 or 3 specific ones, just as people who have written React for a long time say "use less useEffect".

Which ones to drop is not a matter of feel. The consensus in DDD practice: **keep the strategic layer ([Bounded Context](chunk://bounded-context), Ubiquitous Language)**. Every tactical pattern is applied inside some Bounded Context; without that layer you do not know what scope an aggregate or repository applies to. What actually gets skipped or simplified is the **tactical** group, usually left out unless there is a solid reason:

- [Aggregate](chunk://aggregate): do not wrap one unless there is a real invariant ([Vaughn Vernon](https://www.dddcommunity.org/library/vernon_2011/) argues aggregates should be small; big clusters perform badly)
- Domain Event / Event Sourcing: overuse is a recognized anti-pattern
- Full [Repository](chunk://repository-pattern): many teams get by with the ORM directly

The items left out are usually recorded in an ADR (Architecture Decision Record) with the reasons. Otherwise the next person who has read Evans will put them back.
