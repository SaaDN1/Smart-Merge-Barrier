from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from PIL import Image
from ultralytics import YOLO
import numpy as np

model = YOLO('yolo11n.pt')

class Base(BaseModel):
    data: list[int]


def to_image(list):
    arr = np.array(list, dtype=np.uint8)
    arr = arr.reshape(1920, 1080, 4)
    img = Image.fromarray(arr)
    return img

def detect_cars(img):
    results = model(img, verbose=False)
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
    return {"Hello"}

@app.post("/")
async def frame_sent(base: Base):
    img = to_image(base.data)
    detections = detect_cars(img)
    return {"detections": detections}


