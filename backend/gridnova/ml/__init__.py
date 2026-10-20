"""GridNova's own machine learning: no external AI service, no pretrained model.

    nn.py          a small neural network (numpy only): layers, Adam, save / load
    env.py         one simulated campus day as a reinforcement-learning environment
    qagent.py      the Planner's reinforcement-learning agent (Q-learning)
    forecaster.py  the Forecaster's learned demand model (a neural network)
    train.py       trains both on simulated history and writes models/ + models/metrics.json

Everything is trained by `python -m gridnova.ml.train` from the backend folder. The trained
weights are small JSON files committed in models/, so the server only loads them.
"""
