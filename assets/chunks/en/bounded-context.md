---
title: "Bounded Context"
slug: bounded-context
brief: "The same term means different things in different subdomains. Model each separately, and translate explicitly at the boundary."
article: ddd-textbook-vs-real
date: 2026-06-14
---

# Bounded Context

A concept from DDD's strategic layer. The same term has a different definition and usage in each subdomain.

## The classic example

The word "Customer":

| subdomain | Customer model |
|---|---|
| Sales | a potential buyer, with a lead score and a sales rep in charge |
| Support | someone who already bought, with ticket history and a subscription plan |
| Billing | has payment records, invoices, tax settings |

If you force the three subdomains to share one `Customer` class, the fields from all three sides pile into the same class. Changing one place affects the other two subdomains, and the business rules cannot be separated, so it is hard to maintain.

## DDD's answer

Each of the three subdomains has its own Customer. Same name, completely different contents, in different modules:

```typescript
// sales/customer.ts (the customer as Sales sees it)
class Customer { id; leadScore: number; salesRep: string; stage: 'lead' | 'qualified' | 'won' }

// support/customer.ts (the customer as Support sees it)
class Customer { id; tickets: Ticket[]; plan: 'free' | 'pro' }

// billing/customer.ts (the customer as Billing sees it)
class Customer { id; invoices: Invoice[]; taxId: string }
```

All three may map to the same user_id in the database, but in code they are three unrelated classes. Communication across contexts goes through explicit translation (an Anti-Corruption Layer): a Sales Customer is translated into a Support Customer, never shared directly.

## When splitting is worth it

**Split**:

- Several teams each own a different subdomain
- The same word is already causing confusion in the code
- Business rules clearly diverge (Sales rules and Support rules are completely different)

**Do not split**:

- The system is still small and a single model is enough
- Subdomain boundaries are still unclear. A boundary drawn now is only a guess
- The team is not big enough for one squad per BC

The textbook's own words: "**when context boundaries cause friction**, then introduce explicit contexts". Splitting without friction is over-engineering.

## Relation to microservices

It gets compared with microservices because **the most common place to get stuck when splitting microservices is "where to draw the boundary", and DDD's answer is "draw it along bounded contexts"**: cut by business domain, not by technical layer.

But a BC and a microservice are boundaries at different levels:

- A BC is a **logical boundary** (concept level): how models are divided in code
- A microservice is a **deployment boundary** (process level): how many independent services run

So the mapping is flexible: one BC per microservice, several BCs inside one monolith separated by modules, or one BC spread across several microservices. DDD only governs the logical boundary. It does not dictate how many services to deploy.
