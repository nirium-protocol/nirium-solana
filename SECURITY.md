# Security policy

## Reporting a vulnerability

Please do not open a public issue for a security problem. Report it privately through GitHub:
the **Security** tab of this repository, then **Report a vulnerability**. That opens a private
advisory that only the maintainers can see.

Include what you found, how to reproduce it, and what an attacker could do with it. If you have
a fix, describe it in the report; we will set up a private branch for it.

We aim to acknowledge a report within 3 business days and to tell you what we plan to do within
10. There is no bug bounty for this repository.

## Scope

In scope: the code in this repository, in particular anything that could make a client sign a
payment its policy refused, make a verifier accept a receipt that does not match the chain, or
make a payment go somewhere other than the requested `payTo`.

Out of scope: the x402 packages, the PayAI facilitator and the public RPC endpoints this code
talks to. Please report those to their own maintainers.

## Keys

No key belongs in this repository. If you ever see a private key, keypair file or seed phrase in
a commit, report it the same private way so it can be revoked.
