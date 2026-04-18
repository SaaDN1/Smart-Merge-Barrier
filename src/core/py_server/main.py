from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from PIL import Image
from ultralytics import YOLO
import numpy as np

model = YOLO('yolo11n.pt')

class Base(BaseModel):
    data: list[int]
    width: int = Field(gt=0)
    height: int = Field(gt=0)


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

def detect_cars(img):
    results = model(img, imgsz=1280, conf=0.2, verbose=False)
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
    return {"Hello": "python-ai"}

@app.post("/")
async def frame_sent(base: Base):
    try:
        img = to_image(base.data, base.width, base.height)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    detections = detect_cars(img)
    return {"detections": detections}


