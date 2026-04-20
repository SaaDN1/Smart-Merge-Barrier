from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from PIL import Image
from ultralytics import YOLO
import numpy as np
import base64
import io
import os
from typing import Optional
import torch

MODEL_PATH = os.getenv("YOLO_MODEL_PATH", "yolo11m.pt")
DETECT_IMGSZ = int(os.getenv("DETECT_IMGSZ", "960"))
DETECT_CONF = float(os.getenv("DETECT_CONF", "0.25"))
DETECT_CLASSES_RAW = os.getenv("DETECT_CLASSES", "2,3,5,7")
DETECT_CLASSES = [int(item.strip()) for item in DETECT_CLASSES_RAW.split(",") if item.strip().isdigit()]

if not torch.cuda.is_available():
    torch.set_num_threads(max(1, min(8, os.cpu_count() or 4)))

model = YOLO(MODEL_PATH)

class Base(BaseModel):
    data: Optional[list[int]] = None
    width: Optional[int] = Field(default=None, gt=0)
    height: Optional[int] = Field(default=None, gt=0)
    imageData: Optional[str] = None


def to_image(pixels, width, height):
    expected_size = width * height * 4
    if len(pixels) != expected_size:
        raise ValueError(
            f"Invalid frame size: got {len(pixels)} values, expected {expected_size} for {width}x{height} RGBA"
        )

    arr = np.array(pixels, dtype=np.uint8)
    arr = arr.reshape(height, width, 4)
    img = Image.fromarray(arr, mode="RGBA").convert("RGB")
    return img

def to_image_from_base64(image_data):
    payload = image_data.split(",", 1)[1] if "," in image_data else image_data
    raw_bytes = base64.b64decode(payload)
    return Image.open(io.BytesIO(raw_bytes)).convert("RGB")

def detect_cars(img):
    results = model(
        img,
        imgsz=DETECT_IMGSZ,
        conf=DETECT_CONF,
        classes=DETECT_CLASSES if DETECT_CLASSES else None,
        verbose=False
    )
    detections = []
    for r in results:
        for box in r.boxes:
            cls = int(box.cls.item())
            conf = float(box.conf.item())
            xyxy = box.xyxy.tolist()[0]
            class_name = model.names[cls]
            detections.append({
                "class": class_name,
                "confidence": conf,
                "bbox": xyxy
            })
    return detections


app = FastAPI()

origins = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def main():
    return {
        "Hello": "python-ai",
        "model": MODEL_PATH,
        "imgsz": DETECT_IMGSZ,
        "conf": DETECT_CONF,
        "classes": DETECT_CLASSES
    }

@app.post("/")
async def frame_sent(base: Base):
    try:
        if base.imageData:
            img = to_image_from_base64(base.imageData)
        elif base.data is not None and base.width is not None and base.height is not None:
            img = to_image(base.data, base.width, base.height)
        else:
            raise HTTPException(
                status_code=400,
                detail="Provide either imageData (base64) or data+width+height"
            )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid image payload: {exc}") from exc

    detections = detect_cars(img)
    return {"detections": detections}


