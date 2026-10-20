// MOCK: a snapshot of the last real training run (backend/gridnova/ml/models/metrics.json),
// shown when the site runs without the backend. Regenerate it after retraining.
import type { LearningReport } from "@/types/agents";

export const LEARNING_SNAPSHOT: LearningReport = {
  "trained": {
    "trainedAt": "2026-10-20T10:02:56+00:00",
    "trainingSeconds": 62,
    "forecaster": {
      "model": "Neural network 16-48-48-12, tanh, trained with Adam (numpy, written for GridNova)",
      "trainExamples": 7200,
      "validationExamples": 1440,
      "maeKw": 37.3,
      "mapePct": 3.57,
      "maeByHourAheadKw": [
        39.4,
        37.9,
        36.6,
        37.4,
        37.7,
        36.2,
        36.1,
        37.0,
        36.7,
        37.1,
        37.1,
        38.7
      ],
      "baselineMaeKw": {
        "typicalDayProfile": 92.9,
        "sameAsNow": 370.2
      }
    },
    "planner": {
      "model": "Tabular Q-learning, 24 h × 10 battery × 7 load × 4 peak-margin × 5 forecast states, 8 actions",
      "episodes": 40000,
      "statesVisited": 3749,
      "forecastNoisePct": 3.57,
      "curve": [
        {
          "episode": 1000,
          "avgSavedInr": -1034,
          "epsilon": 0.97
        },
        {
          "episode": 2000,
          "avgSavedInr": -976,
          "epsilon": 0.939
        },
        {
          "episode": 3000,
          "avgSavedInr": -855,
          "epsilon": 0.909
        },
        {
          "episode": 4000,
          "avgSavedInr": -778,
          "epsilon": 0.879
        },
        {
          "episode": 5000,
          "avgSavedInr": -743,
          "epsilon": 0.848
        },
        {
          "episode": 6000,
          "avgSavedInr": -526,
          "epsilon": 0.818
        },
        {
          "episode": 7000,
          "avgSavedInr": -404,
          "epsilon": 0.788
        },
        {
          "episode": 8000,
          "avgSavedInr": -223,
          "epsilon": 0.758
        },
        {
          "episode": 9000,
          "avgSavedInr": -44,
          "epsilon": 0.727
        },
        {
          "episode": 10000,
          "avgSavedInr": 61,
          "epsilon": 0.697
        },
        {
          "episode": 11000,
          "avgSavedInr": 146,
          "epsilon": 0.667
        },
        {
          "episode": 12000,
          "avgSavedInr": 360,
          "epsilon": 0.636
        },
        {
          "episode": 13000,
          "avgSavedInr": 505,
          "epsilon": 0.606
        },
        {
          "episode": 14000,
          "avgSavedInr": 691,
          "epsilon": 0.576
        },
        {
          "episode": 15000,
          "avgSavedInr": 932,
          "epsilon": 0.545
        },
        {
          "episode": 16000,
          "avgSavedInr": 1168,
          "epsilon": 0.515
        },
        {
          "episode": 17000,
          "avgSavedInr": 1348,
          "epsilon": 0.485
        },
        {
          "episode": 18000,
          "avgSavedInr": 1650,
          "epsilon": 0.454
        },
        {
          "episode": 19000,
          "avgSavedInr": 1785,
          "epsilon": 0.424
        },
        {
          "episode": 20000,
          "avgSavedInr": 2170,
          "epsilon": 0.394
        },
        {
          "episode": 21000,
          "avgSavedInr": 2295,
          "epsilon": 0.363
        },
        {
          "episode": 22000,
          "avgSavedInr": 2539,
          "epsilon": 0.333
        },
        {
          "episode": 23000,
          "avgSavedInr": 2839,
          "epsilon": 0.303
        },
        {
          "episode": 24000,
          "avgSavedInr": 2988,
          "epsilon": 0.273
        },
        {
          "episode": 25000,
          "avgSavedInr": 3329,
          "epsilon": 0.242
        },
        {
          "episode": 26000,
          "avgSavedInr": 3638,
          "epsilon": 0.212
        },
        {
          "episode": 27000,
          "avgSavedInr": 3748,
          "epsilon": 0.182
        },
        {
          "episode": 28000,
          "avgSavedInr": 3994,
          "epsilon": 0.151
        },
        {
          "episode": 29000,
          "avgSavedInr": 4231,
          "epsilon": 0.121
        },
        {
          "episode": 30000,
          "avgSavedInr": 4590,
          "epsilon": 0.091
        },
        {
          "episode": 31000,
          "avgSavedInr": 4884,
          "epsilon": 0.06
        },
        {
          "episode": 32000,
          "avgSavedInr": 5120,
          "epsilon": 0.03
        },
        {
          "episode": 33000,
          "avgSavedInr": 5255,
          "epsilon": 0.03
        },
        {
          "episode": 34000,
          "avgSavedInr": 5238,
          "epsilon": 0.03
        },
        {
          "episode": 35000,
          "avgSavedInr": 5245,
          "epsilon": 0.03
        },
        {
          "episode": 36000,
          "avgSavedInr": 5270,
          "epsilon": 0.03
        },
        {
          "episode": 37000,
          "avgSavedInr": 5259,
          "epsilon": 0.03
        },
        {
          "episode": 38000,
          "avgSavedInr": 5290,
          "epsilon": 0.03
        },
        {
          "episode": 39000,
          "avgSavedInr": 5268,
          "epsilon": 0.03
        },
        {
          "episode": 40000,
          "avgSavedInr": 5334,
          "epsilon": 0.03
        }
      ],
      "evaluation": {
        "days": 30,
        "avgNoAiInr": 185488,
        "avgRulesInr": 175140,
        "avgLearnedInr": 177781,
        "learnedSavedVsNoAiPct": 4.16,
        "rulesSavedVsNoAiPct": 5.58,
        "learnedVsRulesInr": -2641,
        "learnedBeatsRulesDays": 0,
        "minSocPct": 20.0
      }
    },
    "scenarios": [
      {
        "type": "cloud_cover",
        "baselineMin": 9.0,
        "runs": [
          {
            "run": 1,
            "recoveryMin": 4.6,
            "twinRuns": 64,
            "plan": "Cap import at 1,113 kW, bridge the solar dip",
            "costInr": 73018
          },
          {
            "run": 2,
            "recoveryMin": 1.8,
            "twinRuns": 8,
            "plan": "Cap import at 1,113 kW, bridge the solar dip",
            "costInr": 73018,
            "lessonApplied": "Cap import at 1,113 kW, bridge the solar dip worked best at severity 3, 17:20, battery 82% (₹73,018 in the twin)."
          },
          {
            "run": 3,
            "recoveryMin": 1.8,
            "twinRuns": 8,
            "plan": "Cap import at 1,113 kW, bridge the solar dip",
            "costInr": 73018,
            "lessonApplied": "Cap import at 1,113 kW, bridge the solar dip worked best at severity 3, 17:20, battery 82% (₹73,018 in the twin)."
          }
        ]
      },
      {
        "type": "heatwave",
        "baselineMin": 12.0,
        "runs": [
          {
            "run": 1,
            "recoveryMin": 4.0,
            "twinRuns": 48,
            "plan": "Cap import at 1,100 kW",
            "costInr": 73089
          },
          {
            "run": 2,
            "recoveryMin": 2.0,
            "twinRuns": 8,
            "plan": "Cap import at 1,100 kW",
            "costInr": 73089,
            "lessonApplied": "Cap import at 1,100 kW worked best at severity 3, 17:20, battery 82% (₹73,089 in the twin)."
          },
          {
            "run": 3,
            "recoveryMin": 2.0,
            "twinRuns": 8,
            "plan": "Cap import at 1,100 kW",
            "costInr": 73089,
            "lessonApplied": "Cap import at 1,100 kW worked best at severity 3, 17:20, battery 82% (₹73,089 in the twin)."
          }
        ]
      },
      {
        "type": "line_failure",
        "baselineMin": 21.0,
        "runs": [
          {
            "run": 1,
            "recoveryMin": 6.6,
            "twinRuns": 48,
            "plan": "Reroute GH1 at 78%, cap import at 1,090 kW",
            "costInr": 72229
          },
          {
            "run": 2,
            "recoveryMin": 4.6,
            "twinRuns": 8,
            "plan": "Reroute GH1 at 78%, cap import at 1,090 kW",
            "costInr": 72229,
            "lessonApplied": "Reroute GH1 at 78%, cap import at 1,090 kW worked best at severity 3, 17:20, battery 82% (₹72,229 in the twin)."
          },
          {
            "run": 3,
            "recoveryMin": 4.6,
            "twinRuns": 8,
            "plan": "Reroute GH1 at 78%, cap import at 1,090 kW",
            "costInr": 72229,
            "lessonApplied": "Reroute GH1 at 78%, cap import at 1,090 kW worked best at severity 3, 17:20, battery 82% (₹72,229 in the twin)."
          }
        ]
      },
      {
        "type": "grid_outage",
        "baselineMin": 14.0,
        "runs": [
          {
            "run": 1,
            "recoveryMin": 6.4,
            "twinRuns": 48,
            "plan": "Hostels at 49%",
            "costInr": 73292
          },
          {
            "run": 2,
            "recoveryMin": 4.4,
            "twinRuns": 8,
            "plan": "Hostels at 49%",
            "costInr": 73292,
            "lessonApplied": "Hostels at 49% worked best at severity 3, 17:20, battery 82% (₹73,292 in the twin)."
          },
          {
            "run": 3,
            "recoveryMin": 4.4,
            "twinRuns": 8,
            "plan": "Hostels at 49%",
            "costInr": 73292,
            "lessonApplied": "Hostels at 49% worked best at severity 3, 17:20, battery 82% (₹73,292 in the twin)."
          }
        ]
      }
    ]
  },
  "live": {
    "forecasterOnlineUpdates": 0,
    "forecasterLiveMaeKw": null,
    "memories": []
  },
  "available": {
    "forecaster": true,
    "plannerPolicy": true
  }
};
