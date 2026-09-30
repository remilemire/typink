
= Lecture 3 — Waves
Typed notes sit on the ruling, and sketches from the iPad drop right into the flow. Here is a *strong* claim with _emphasis_ and `inline code`, plus a #hl[highlighted phrase].

== Key ideas
- Superposition: waves add linearly.
- Standing waves form between two fixed ends.
  - Nodes and antinodes alternate.
+ First numbered point
+ Second numbered point

#sketch("sk1")

The wave equation:
$ (partial^2 u) / (partial t^2) = c^2 (partial^2 u) / (partial x^2) $

#task[Review chapter 4]
#task(done: true)[Finish problem set 2]
#task[Email the TA#margin-note[ask about Thursday]]

#tip[Draw the node/antinode diagram before solving.]

```python
def wave(x, t, c=1.0):
    return sin(x - c * t)
```

#cols[
  Left column text explaining the diagram on the right.
][
  #sketch("sk2")
]

#table(columns: 3, [*f*], [*λ*], [*v*], [1 Hz], [2 m], [2 m/s])

#quote(block: true)[A block quote to finish.]
#divider()
Final paragraph after the divider.
