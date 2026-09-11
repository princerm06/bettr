"""JS-compatible mulberry32 / Fisher–Yates (Candidate #3A.3 / G.1)."""

from __future__ import annotations

from ctypes import c_int32


def _u32(x: int) -> int:
    return x & 0xFFFFFFFF


def imul(a: int, b: int) -> int:
    return c_int32(_u32(a) * _u32(b)).value


def mulberry32(seed: int):
    a = _u32(seed)

    def rng() -> float:
        nonlocal a
        a = _u32(a + 0x6D2B79F5)
        t = a
        t = imul(t ^ (t >> 15), t | 1)
        t ^= _u32(t + imul(t ^ (_u32(t) >> 7), t | 61))
        return _u32(t ^ (_u32(t) >> 14)) / 4294967296

    return rng


def shuffle(items: list, rng) -> list:
    out = list(items)
    for i in range(len(out) - 1, 0, -1):
        j = int(rng() * (i + 1))
        out[i], out[j] = out[j], out[i]
    return out


def shuffle_seeded(items: list, seed: int) -> list:
    return shuffle(items, mulberry32(seed))
