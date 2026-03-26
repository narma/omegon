---
id: macos-local-auth-keychain-ux
title: "macOS local auth refinements for keychain secret UX"
status: seed
parent: rust-native-sigstore-update-verification
tags: [macos, security, ux, secrets]
open_questions: []
dependencies: []
related: []
---

# macOS local auth refinements for keychain secret UX

## Overview

Investigate and improve macOS local authentication UX for keychain-backed Omegon secrets. Goals: reduce friction from repeated Keychain prompts across updated binaries, determine whether Touch ID / Apple Watch / biometric approval can be used instead of password entry, and improve operator messaging around read vs write authorization semantics.
