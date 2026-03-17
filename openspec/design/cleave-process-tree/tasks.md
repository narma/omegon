# Cleave Process Tree — bidirectional parent↔child coordination — Design Tasks

## 1. Open Questions

- [ ] 1.1 What is the steer throttling policy? Max steers per child? Only when scope overlaps? Only for published interfaces/decisions, not raw progress?
- [ ] 1.2 Does the review loop need to change for MVP, or can we defer review-over-RPC to Phase 2? (Review currently spawns a separate process — could continue using pipe mode even if primary execution uses RPC.)
