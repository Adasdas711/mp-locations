# XFeat backbone weights

`xfeat-backbone.bin` contains the convolutional backbone of **XFeat: Accelerated Features for Lightweight Image Matching** (Guilherme Potje, Felipe Cadar, André Araujo, Renato Martins, Erickson R. Nascimento, CVPR 2024), from <https://github.com/verlab/accelerated_features> (`weights/xfeat.pt`), licensed under the Apache License 2.0 (see `LICENSE`).

Conversion: the weights were loaded as tensors only (`torch.load(..., weights_only=True)`), the parameter-free BatchNorm layers were folded into the preceding convolutions, the unused fine-matching MLP was dropped and the remaining 659,282 parameters were stored as float16. Layout: little-endian `u32` header length, a JSON header (`format: "palace-xfeat-1"`, per-layer shape, stride, padding and offset) and the float16 weights followed by biases per layer.

`calibration-xfeat.js` evaluates the network in plain JavaScript (no ONNX/WebAssembly runtime). `test/calibration-xfeat.cjs` compares its outputs with reference values computed by the PyTorch model.
