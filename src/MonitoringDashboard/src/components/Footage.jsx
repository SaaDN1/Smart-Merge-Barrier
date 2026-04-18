import { useEffect, useRef } from "react";

const BACKEND_AI_URL = "http://localhost:5000/api/ai";
const CAPTURE_INTERVAL_MS = 1000;
const CLASS_COLORS = {
    car: "#39ff14",
    person: "#33b1ff",
    bus: "#ffb000",
    truck: "#ff5e5e",
    motorcycle: "#b388ff",
    bicycle: "#00d4a6"
};

function Footage({ onDetections }) {
    const videoRef = useRef(null);
    const captureCanvasRef = useRef(null);
    const overlayCanvasRef = useRef(null);

    useEffect(() => {
        let isRequestInFlight = false;

        const syncOverlayCanvasSize = () => {
            const video = videoRef.current;
            const overlayCanvas = overlayCanvasRef.current;

            if (!video || !overlayCanvas || !video.videoWidth || !video.videoHeight) {
                return null;
            }

            overlayCanvas.width = video.videoWidth;
            overlayCanvas.height = video.videoHeight;
            overlayCanvas.style.width = `${video.clientWidth}px`;
            overlayCanvas.style.height = `${video.clientHeight}px`;
            return overlayCanvas.getContext("2d");
        };

        const drawDetections = (detections) => {
            const ctx = syncOverlayCanvasSize();
            const overlayCanvas = overlayCanvasRef.current;

            if (!ctx || !overlayCanvas) {
                return;
            }

            ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
            ctx.lineWidth = 3;
            ctx.font = "16px sans-serif";

            detections.forEach((det) => {
                if (!Array.isArray(det?.bbox) || det.bbox.length !== 4) {
                    return;
                }

                const [x1, y1, x2, y2] = det.bbox;
                const width = Math.max(0, x2 - x1);
                const height = Math.max(0, y2 - y1);
                const boxColor = CLASS_COLORS[det.class] || "#e6eef6";
                const label = `${det.class} ${(Number(det.confidence) * 100).toFixed(0)}%`;

                ctx.strokeStyle = boxColor;
                ctx.strokeRect(x1, y1, width, height);

                ctx.fillStyle = "rgba(2, 6, 23, 0.85)";
                const textWidth = ctx.measureText(label).width;
                ctx.fillRect(x1, Math.max(0, y1 - 24), textWidth + 10, 22);

                ctx.fillStyle = boxColor;
                ctx.fillText(label, x1, Math.max(18, y1 - 6));
            });
        };

        const captureAndSend = async () => {
            const video = videoRef.current;
            const canvas = captureCanvasRef.current;

            if (!video || !canvas) {
                return;
            }

            if (isRequestInFlight || video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
                return;
            }

            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;

            const ctx = canvas.getContext("2d");
            if (!ctx) {
                return;
            }

            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);

            isRequestInFlight = true;

            try {
                const response = await fetch(BACKEND_AI_URL, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        data: Array.from(frame.data),
                        width: canvas.width,
                        height: canvas.height
                    })
                });

                if (!response.ok) {
                    throw new Error(`AI request failed with status ${response.status}`);
                }

                const payload = await response.json();
                const detections = Array.isArray(payload?.detections) ? payload.detections : [];
                onDetections(detections);
                drawDetections(detections);
            } catch (error) {
                console.error("Error sending frame to backend AI:", error);
            } finally {
                isRequestInFlight = false;
            }
        };

        const onResize = () => {
            syncOverlayCanvasSize();
        };

        window.addEventListener("resize", onResize);
        const interval = setInterval(captureAndSend, CAPTURE_INTERVAL_MS);
        return () => {
            clearInterval(interval);
            window.removeEventListener("resize", onResize);
        };
    }, [onDetections]);

    return (
        <div className="footage-wrap" style={{ maxWidth: "55%", width: "55%" }}>
            <video
                ref={videoRef}
                className="footage-video"
                src="/videos/5927708-hd_1080_1920_30fps.mp4"
                style={{ width: "55%", height: "auto", maxWidth: "55%", display: "block" }}
                loop
                autoPlay
                muted
                playsInline
            ></video>
            <canvas ref={overlayCanvasRef} className="footage-overlay" style={{ width: "55%", height: "auto", maxWidth: "55%" }}></canvas>
            <canvas ref={captureCanvasRef} hidden></canvas>
        </div>
    );
}

export default Footage;