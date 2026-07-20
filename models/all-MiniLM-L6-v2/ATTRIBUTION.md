# Model attribution

- **Identity:** `sentence-transformers/all-MiniLM-L6-v2` (MiniLM L6, 384-d sentence encoder)
- **ONNX package:** `Xenova/all-MiniLM-L6-v2` for Transformers.js
- **Weights used at runtime:** `onnx/model_quantized.onnx` (dynamic quantized ONNX, ~22 MB)
- **License:** Apache-2.0 (see `LICENSE`)
- **Use in this game:** closed-set coaching intent ranking only; no generative dialogue

Original work: https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2  
ONNX conversion: https://huggingface.co/Xenova/all-MiniLM-L6-v2

**Size tradeoff:** L6 quantized (~22 MB) is preferred over MiniLM-L3 for ranking quality while remaining practical for a static localhost game. The full fp32 `model.onnx` (~90 MB) is not shipped.
