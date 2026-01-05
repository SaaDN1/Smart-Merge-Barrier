from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from PIL import Image
from ultralytics import YOLO
import numpy as np

model = YOLO()

class Base(BaseModel):
    data: list[int]


def to_image(list):
    arr = np.array(list, dtype=np.uint8)
    arr = arr.reshape(1920, 1080, 4)
    img = Image.fromarray(arr)
    return img

def detect_cars(img):
    prediction = model(img)
    return prediction


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
    results = detect_cars(img)
    for r in results:
        print(len(r.boxes))


