"""Tiny stand-in for paddleocr used by the worker protocol test."""


class LayoutDetection:
    def __init__(self, model_name=None):
        self.model_name = model_name

    def predict(self, path):
        return [
            {
                "boxes": [
                    {"label": "figure", "score": 0.99, "coordinate": [100, 100, 800, 1200]},
                    {"label": "figure_caption", "score": 0.98, "coordinate": [100, 1210, 1100, 1300]},
                    {"label": "table", "score": 0.97, "coordinate": [120, 1320, 1100, 1500]},
                ]
            }
        ]
