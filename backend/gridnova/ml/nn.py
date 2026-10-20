"""A small feed-forward neural network written from scratch with numpy.

Dense layers with tanh hidden units and a linear output, trained with mini-batch Adam on
mean squared error. Inputs and targets are standardised with statistics learned from the
training data, and stored with the weights so a saved model is self-contained.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np


class MLP:
    def __init__(self, sizes: list[int], seed: int = 0):
        rng = np.random.default_rng(seed)
        self.sizes = list(sizes)
        # Glorot-style initialisation keeps tanh units out of saturation at the start.
        self.W = [rng.normal(0, np.sqrt(2 / (a + b)), (a, b)) for a, b in zip(sizes[:-1], sizes[1:])]
        self.b = [np.zeros(b) for b in sizes[1:]]
        self.x_mean = np.zeros(sizes[0])
        self.x_std = np.ones(sizes[0])
        self.y_mean = np.zeros(sizes[-1])
        self.y_std = np.ones(sizes[-1])

    # ---------- inference ----------
    def _forward(self, x: np.ndarray) -> tuple[np.ndarray, list[np.ndarray]]:
        acts = [x]
        h = x
        for i, (W, b) in enumerate(zip(self.W, self.b)):
            z = h @ W + b
            h = z if i == len(self.W) - 1 else np.tanh(z)
            acts.append(h)
        return h, acts

    def predict(self, x: np.ndarray) -> np.ndarray:
        x = np.atleast_2d(np.asarray(x, dtype=float))
        out, _ = self._forward((x - self.x_mean) / self.x_std)
        return out * self.y_std + self.y_mean

    # ---------- training ----------
    def fit(self, X: np.ndarray, Y: np.ndarray, epochs: int = 60, batch: int = 128, lr: float = 3e-3,
            l2: float = 1e-5, seed: int = 0, X_val: np.ndarray | None = None, Y_val: np.ndarray | None = None) -> list[dict]:
        """Trains on (X, Y) and returns the loss curve (train / validation MSE in target units)."""
        rng = np.random.default_rng(seed)
        X = np.asarray(X, dtype=float)
        Y = np.asarray(Y, dtype=float).reshape(len(X), -1)
        self.x_mean, self.x_std = X.mean(0), X.std(0) + 1e-8
        self.y_mean, self.y_std = Y.mean(0), Y.std(0) + 1e-8
        Xn, Yn = (X - self.x_mean) / self.x_std, (Y - self.y_mean) / self.y_std
        m = [np.zeros_like(p) for p in self.W + self.b]
        v = [np.zeros_like(p) for p in self.W + self.b]
        b1, b2, t = 0.9, 0.999, 0
        curve = []
        for epoch in range(epochs):
            order = rng.permutation(len(Xn))
            for k in range(0, len(order), batch):
                idx = order[k:k + batch]
                gW, gb = self._grads(Xn[idx], Yn[idx], l2)
                t += 1
                for j, (p, g) in enumerate(zip(self.W + self.b, gW + gb)):
                    m[j] = b1 * m[j] + (1 - b1) * g
                    v[j] = b2 * v[j] + (1 - b2) * g * g
                    p -= lr * (m[j] / (1 - b1 ** t)) / (np.sqrt(v[j] / (1 - b2 ** t)) + 1e-8)
            row = {"epoch": epoch + 1, "trainMse": float(np.mean((self.predict(X) - Y) ** 2))}
            if X_val is not None and Y_val is not None:
                row["valMse"] = float(np.mean((self.predict(X_val) - np.asarray(Y_val).reshape(len(X_val), -1)) ** 2))
            curve.append(row)
        return curve

    def _grads(self, Xn: np.ndarray, Yn: np.ndarray, l2: float) -> tuple[list[np.ndarray], list[np.ndarray]]:
        """Backpropagation of the mean squared error (normalised units)."""
        out, acts = self._forward(Xn)
        grad = 2 * (out - Yn) / len(Xn)
        gW, gb = [None] * len(self.W), [None] * len(self.b)
        for i in reversed(range(len(self.W))):
            gW[i] = acts[i].T @ grad + l2 * self.W[i]
            gb[i] = grad.sum(0)
            if i:
                grad = (grad @ self.W[i].T) * (1 - acts[i] ** 2)  # back through tanh
        return gW, gb

    def sgd(self, X: np.ndarray, Y: np.ndarray, steps: int = 8, lr: float = 1e-3, l2: float = 1e-5) -> None:
        """A few plain gradient steps on new examples (online learning); keeps the trained scaling."""
        Xn = (np.asarray(X, dtype=float) - self.x_mean) / self.x_std
        Yn = (np.asarray(Y, dtype=float).reshape(len(Xn), -1) - self.y_mean) / self.y_std
        for _ in range(steps):
            gW, gb = self._grads(Xn, Yn, l2)
            for p, g in zip(self.W + self.b, gW + gb):
                p -= lr * g

    # ---------- persistence ----------
    def to_dict(self) -> dict:
        return {
            "sizes": self.sizes,
            "W": [w.round(6).tolist() for w in self.W],
            "b": [b.round(6).tolist() for b in self.b],
            "x_mean": self.x_mean.tolist(), "x_std": self.x_std.tolist(),
            "y_mean": self.y_mean.tolist(), "y_std": self.y_std.tolist(),
        }

    @classmethod
    def from_dict(cls, d: dict) -> "MLP":
        net = cls(d["sizes"])
        net.W = [np.array(w) for w in d["W"]]
        net.b = [np.array(b) for b in d["b"]]
        for k in ("x_mean", "x_std", "y_mean", "y_std"):
            setattr(net, k, np.array(d[k]))
        return net

    def save(self, path: Path) -> None:
        path.write_text(json.dumps(self.to_dict()))

    @classmethod
    def load(cls, path: Path) -> "MLP":
        return cls.from_dict(json.loads(path.read_text()))
