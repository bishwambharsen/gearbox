# Gearbox configuration

Gearbox reads `~/.gearbox/config.json` at startup. The file is optional — without it, the defaults below apply. Anything you put in the file is deep-merged over the defaults, so you only specify the keys you want to change. Set `GEARBOX_CONFIG=/path/to/config.json` to load a different file (a path that doesn't exist is an error, so typos fail loudly).

Print the effective (merged) config at any time:

```bash
npx gearbox config
```

## Full default config

```json
{
  "port": 8484,
  "upstreamBaseUrl": "https://api.anthropic.com",
  "tiers": {
    "haiku":  { "modelId": "claude-haiku-4-5",  "inputPrice": 1,  "outputPrice": 5,   "cacheReadMultiplier": 0.1, "cacheWriteMultiplier": 1.25 },
    "sonnet": { "modelId": "claude-sonnet-5",   "inputPrice": 3,  "outputPrice": 15,  "cacheReadMultiplier": 0.1, "cacheWriteMultiplier": 1.25 },
    "opus":   { "modelId": "claude-opus-4-8",   "inputPrice": 15, "outputPrice": 75,  "cacheReadMultiplier": 0.1, "cacheWriteMultiplier": 1.25 },
    "fable":  { "modelId": "claude-fable-5",    "inputPrice": 25, "outputPrice": 125, "cacheReadMultiplier": 0.1, "cacheWriteMultiplier": 1.25 }
  },
  "defaultTier": "sonnet",
  "maxTier": "fable",
  "baselineModel": "claude-opus-4-8",
  "routing": {
    "longContextThreshold": 150000,
    "escalationFailureThreshold": 2,
    "switchMarginUsd": 0.01
  },
  "ledgerPath": "~/.gearbox/ledger.jsonl"
}
```

(`ledgerPath` is shown with `~` for brevity; the real default is the expanded absolute path.)

## Options

### Server

| Key | Default | Meaning |
|-----|---------|---------|
| `port` | `8484` | Local port the proxy listens on. Point Claude Code at it with `ANTHROPIC_BASE_URL=http://localhost:8484`. |
| `upstreamBaseUrl` | `https://api.anthropic.com` | Where requests are forwarded. Only change this if you're chaining proxies or testing. |

### Tiers (the gear ladder)

`tiers` maps each of the four fixed gear names — `haiku`, `sonnet`, `opus`, `fable` — to a model and its pricing. All four must be present (defaults fill in whatever you don't override). Prices are **USD per million tokens** and exist so the ledger can compute real costs; keep them in sync with [anthropic.com/pricing](https://www.anthropic.com/pricing).

| Key | Meaning |
|-----|---------|
| `modelId` | The exact model ID sent upstream when this gear is selected. |
| `inputPrice` / `outputPrice` | USD per million input/output tokens. |
| `cacheReadMultiplier` | Cache-read price as a multiple of `inputPrice` (Anthropic default ≈ 0.1). |
| `cacheWriteMultiplier` | Cache-write price as a multiple of `inputPrice` (Anthropic default ≈ 1.25). |

Example — pin gear 2 to a dated snapshot:

```json
{ "tiers": { "sonnet": { "modelId": "claude-sonnet-5-20260115" } } }
```

### Routing

| Key | Default | Meaning |
|-----|---------|---------|
| `defaultTier` | `"sonnet"` | Gear used when no rule fires — the router's resting state. |
| `maxTier` | `"fable"` | Highest gear the router may pick on its own. An explicit `!gear=` override can still go higher. Set to `"opus"` to keep Fable strictly opt-in. |
| `routing.longContextThreshold` | `150000` | Estimated prompt tokens above which downshifting is refused (big contexts go to a gear that handles them well). |
| `routing.escalationFailureThreshold` | `2` | Consecutive failed tool calls before the router force-upshifts one gear. |
| `routing.switchMarginUsd` | `0.01` | A downshift must be expected to save at least this much (after prompt-cache re-warm cost) or the router stays in gear. Raise it for stickier routing. |

### Ledger

| Key | Default | Meaning |
|-----|---------|---------|
| `baselineModel` | `"claude-opus-4-8"` | The counterfactual: `gearbox report` compares actual spend against running every request on this model. Set it to whatever you'd use without Gearbox. |
| `ledgerPath` | `~/.gearbox/ledger.jsonl` | Where usage entries are appended (JSONL, one entry per request). |

## In-chat overrides

Regardless of config, you can force a gear for the current request by typing a magic string anywhere in your message: `!gear=haiku`, `!gear=sonnet`, `!gear=opus`, or `!gear=fable`. Only valid tier names are honored.
