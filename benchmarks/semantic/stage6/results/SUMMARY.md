# Stage 6 report

Generated: 2026-09-30T18:52:17Z

## Conclusion

A critical trap was supported. The small synthetic cross-encoder direction should be abandoned. A larger MNLI model was not tried.

Code: `abandon_critical_trap`

## Head-only

- Selected epoch: 7
- Critical-trap supports: 1
- Swap control ok: True
- Unsafe false supports: 25 / 128
- Same-predicate recall: 0.9038 on n=52
- Negation supports: 0 of 12
- Attempted/contradictory false supports: 1
- Train support precision: 0.9416586306653809
- Locked-test support precision: 0.6795
- Precision gap: 0.2622
- LoRA authorized: False (Head-only predicted SUPPORTS on a must-not-support critical trap.)

## Gates

- criticalTrapSupports: pass=False value=1
- swapControl: pass=True value=True
- unsafeFalseSupports: pass=False value=25
- samePredicateRecall: pass=True value=0.9038461538461539
- explicitNegation: pass=True value={'supports': 0, 'notSupports': 12, 'n': 12}
- attemptedContradictory: pass=False value=1
- precisionGap: pass=False value=0.2621714511782014
- all: pass=False value=None

## Resources

- Peak RSS MB: 474
- Production hashes unchanged: True

