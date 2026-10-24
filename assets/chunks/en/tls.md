---
title: "TLS"
slug: tls
brief: "TLS 1.3 finishes the handshake in one RTT and proves the server's identity with a CA signed certificate. The cost is handshake CPU and latency."
article: security-journey
date: 2026-03-09
updated: 2026-10-18
revisions: 3
---

# TLS

Without TLS, every machine along the path can read every packet between client and server. Passwords, tokens and API keys travel in plain text. TLS encrypts this channel.

## Handshake

A browser connects to shop.example for the first time. The TLS 1.3 handshake takes one RTT:

```
Client → ClientHello (supported ciphers, key share) → Server
Client ← ServerHello (chosen cipher, key share) ← Server
Client ← EncryptedExtensions, Certificate, CertificateVerify, Finished (encrypted) ← Server
Client → Finished (encrypted) → Server
```

The key share is the material for Diffie-Hellman. Each side picks a random private number and sends only the public value computed from it. Once each side has the other's public value, both compute the same shared key locally. Anyone on the path sees the two public values, but without either side's private number cannot compute the key, so the key itself never travels over the network. From then on both sides use that key for symmetric encryption.

Once the ServerHello is sent, each side has the other's key share and can compute the handshake key, so the messages the server sends right after it are already encrypted. The certificate travels in the Certificate message among them, hidden from anyone on the path. CertificateVerify is a signature the server makes with the private key that matches the certificate, proving the certificate really belongs to it. How the certificate proves the other end is shop.example is the next section. TLS 1.2 needs two RTTs, and sends the certificate in plain text. TLS 1.3 also supports 0-RTT resumption, so a repeat connection can carry data in its very first packet.

## Certificates

The key exists, but how does the browser know the other end is shop.example itself and not some machine on the path pretending? A certificate binds a domain name to a public key. The certificate the browser receives names shop.example and its public key, signed by an intermediate CA; the intermediate CA's own certificate is signed by a root CA; and the root CA's certificate ships inside the browser. The browser verifies the signatures along that chain, and only continues when all three check out and the domain matches. An impostor can produce a certificate that says shop.example, but cannot get it signed by any CA the browser trusts, and the browser rejects it outright.

**Let's Encrypt** automated issuance. Certificates used to cost money, and expiry often went unnoticed; today auto-renewal is the default practice.

**mTLS** (mutual TLS) works the other way round too: the server also verifies the client's certificate. Common for service-to-service traffic, where both sides need proof of identity.

## Cost

**CPU.** The handshake uses asymmetric encryption (RSA/ECDSA), which is expensive per connection. The symmetric encryption that follows is cheap. Modern hardware has AES-NI, and several Gbps is not a problem.

**Latency.** The first connection costs one extra RTT (TLS 1.3). On a long-lived connection this is barely noticeable, but when many short connections arrive at once the cost becomes visible.

## When it matters

On the public internet, TLS is mandatory. Inside a network, mTLS is the basis of zero trust; the hard part is who issues the certificates and who rotates them, and part of what a service mesh does is handle exactly that.
