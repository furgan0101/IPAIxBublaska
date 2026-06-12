---
name: verify-ai-pipeline
description: Tests the backend LLM extraction schema and geospatial radius math without hitting live APIs.
---
# Instructions
1. Run the backend unit tests focused on the JSON parsing functions and the 1km radius clustering logic.
2. If type errors occur in Pydantic models or distance calculation fails, isolate the traceback and propose a fix. Do not blindly rewrite the core math.
