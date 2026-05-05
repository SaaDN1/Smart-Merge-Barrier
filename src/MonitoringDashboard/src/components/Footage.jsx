import { useEffect, useRef, useState } from "react";
import { apiJson } from "../api.js";
import defaultCameraFeedConfig from "../data/cameraFeeds.json";

const MIN_CAPTURE_INTERVAL_MS = 100;
const UI_UPDATE_INTERVAL_MS = 200;
const MAX_CAPTURE_WIDTH = 640;
const MIN_CAPTURE_WIDTH = 384;
const CAPTURE_STEP = 64;
const FAST_INFERENCE_MS = 220;
const SLOW_INFERENCE_MS = 420;
const JPEG_QUALITY = 0.5;
const ZOOM_SCALE = 2;
const DEFAULT_CAMERA_FEEDS = defaultCameraFeedConfig.map(({ id, label, trafficLevel, src }) => ({
    id,
    label,
    trafficLevel,
    src
}));
const DEFAULT_VIDEO_SRC = DEFAULT_CAMERA_FEEDS[0]?.src || "/videos/5927708-hd_1080_1920_30fps.mp4";
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
    const frameSizeRef = useRef({ width: 0, height: 0 });
    const currentCameraIdRef = useRef("camera-main");
    const hasLoadedBackendFeedsRef = useRef(false);
    const brokenCameraIdsRef = useRef(new Set());
    const lastUiUpdateRef = useRef(0);
    const adaptiveCaptureWidthRef = useRef(MAX_CAPTURE_WIDTH);
    const inferenceTimesRef = useRef([]);
    const [cameraFeeds, setCameraFeeds] = useState(DEFAULT_CAMERA_FEEDS);
    const [selectedCameraId, setSelectedCameraId] = useState(DEFAULT_CAMERA_FEEDS[0].id);
    const [activeVideoSrc, setActiveVideoSrc] = useState(DEFAULT_CAMERA_FEEDS[0].src);
    const [sourceNotice, setSourceNotice] = useState("");
    const [isZoomed, setIsZoomed] = useState(false);
    const [zoomOrigin, setZoomOrigin] = useState({ x: 50, y: 50 });
    const currentCamera =
        cameraFeeds.find((feed) => feed.id === selectedCameraId)
        || cameraFeeds[0]
        || DEFAULT_CAMERA_FEEDS[0];

    useEffect(() => {
        let isDisposed = false;

        const fetchCameraFeeds = async () => {
            try {
                const payload = await apiJson("/api/cameras");
                const feeds = Array.isArray(payload) && payload.length > 0
                    ? payload.map((cam, index) => ({
                        id: cam.id || `camera-${index + 1}`,
                        label: cam.label || cam.cameraID || `Camera ${index + 1}`,
                        trafficLevel: cam.trafficLevel || "Unknown",
                        src: cam.src || DEFAULT_CAMERA_FEEDS[index]?.src || DEFAULT_VIDEO_SRC
                    }))
                    : DEFAULT_CAMERA_FEEDS;

                if (isDisposed) {
                    return;
                }

                hasLoadedBackendFeedsRef.current = true;
                const currentId = currentCameraIdRef.current;
                const selectedExists = feeds.some((feed) => feed.id === currentId);

                setCameraFeeds(feeds);
                if (!selectedExists) {
                    setSelectedCameraId(feeds[0]?.id || DEFAULT_CAMERA_FEEDS[0].id);
                }
                setSourceNotice("");
            } catch (error) {
                if (isDisposed) {
                    return;
                }

                console.error("Failed to load camera feeds:", error);
                if (!hasLoadedBackendFeedsRef.current) {
                    setCameraFeeds(DEFAULT_CAMERA_FEEDS);
                    const currentId = currentCameraIdRef.current;
                    const selectedExists = DEFAULT_CAMERA_FEEDS.some((feed) => feed.id === currentId);
                    if (!selectedExists) {
                        setSelectedCameraId(DEFAULT_CAMERA_FEEDS[0].id);
                    }
                }
                setSourceNotice("Using fallback camera feeds because backend camera list is unavailable.");
            }
        };

        fetchCameraFeeds();

        const retryIntervalId = window.setInterval(fetchCameraFeeds, 5000);

        return () => {
            isDisposed = true;
            clearInterval(retryIntervalId);
        };
    }, []);

    useEffect(() => {
        currentCameraIdRef.current = currentCamera?.id || "camera-main";

        const isBroken = currentCamera ? brokenCameraIdsRef.current.has(currentCamera.id) : false;
        const desiredSrc = isBroken
            ? DEFAULT_VIDEO_SRC
            : (currentCamera?.src || DEFAULT_VIDEO_SRC);

        if (desiredSrc !== activeVideoSrc) {
            setActiveVideoSrc(desiredSrc);
        }
    }, [currentCamera, activeVideoSrc]);

    const updateZoomOrigin = (event) => {
        const rect = event.currentTarget.getBoundingClientRect();

        if (!rect.width || !rect.height) {
            return;
        }

        const nextX = ((event.clientX - rect.left) / rect.width) * 100;
        const nextY = ((event.clientY - rect.top) / rect.height) * 100;

        setZoomOrigin({
            x: Math.min(100, Math.max(0, nextX)),
            y: Math.min(100, Math.max(0, nextY))
        });
    };

    const handleToggleZoom = (event) => {
        updateZoomOrigin(event);
        setIsZoomed((prev) => !prev);
    };

    const handleMouseMove = (event) => {
        if (!isZoomed) {
            return;
        }

        updateZoomOrigin(event);
    };

    const clearOverlay = () => {
        const overlayCanvas = overlayCanvasRef.current;
        const ctx = overlayCanvas?.getContext("2d");

        if (!overlayCanvas || !ctx) {
            return;
        }

        ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    };

    const handleNextCameraClick = (event) => {
        event.stopPropagation();

        if (!cameraFeeds.length) {
            return;
        }

        const currentIndex = cameraFeeds.findIndex((feed) => feed.id === currentCameraIdRef.current);
        const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % cameraFeeds.length : 0;
        setSelectedCameraId(cameraFeeds[nextIndex].id);

        setSourceNotice("");
        adaptiveCaptureWidthRef.current = MAX_CAPTURE_WIDTH;
        inferenceTimesRef.current = [];
        setIsZoomed(false);
        setZoomOrigin({ x: 50, y: 50 });
        if (typeof onDetections === "function") {
            onDetections({ detections: [] });
        }
        clearOverlay();
    };

    const handleVideoError = () => {
        if (activeVideoSrc === DEFAULT_VIDEO_SRC) {
            return;
        }

        brokenCameraIdsRef.current.add(currentCameraIdRef.current);
        setActiveVideoSrc(DEFAULT_VIDEO_SRC);
        setSourceNotice("Selected camera stream is unavailable. Falling back to default video feed.");
    };

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

            const frameWidth = frameSizeRef.current.width || overlayCanvas.width;
            const frameHeight = frameSizeRef.current.height || overlayCanvas.height;
            const scaleX = overlayCanvas.width / frameWidth;
            const scaleY = overlayCanvas.height / frameHeight;

            ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
            ctx.lineWidth = 3;
            ctx.font = "16px sans-serif";

            detections.forEach((det) => {
                if (!Array.isArray(det?.bbox) || det.bbox.length !== 4) {
                    return;
                }

                const [x1, y1, x2, y2] = det.bbox;
                const sx1 = x1 * scaleX;
                const sy1 = y1 * scaleY;
                const sx2 = x2 * scaleX;
                const sy2 = y2 * scaleY;
                const width = Math.max(0, sx2 - sx1);
                const height = Math.max(0, sy2 - sy1);
                const boxColor = CLASS_COLORS[det.class] || "#e6eef6";
                const label = `${det.class} ${(Number(det.confidence) * 100).toFixed(0)}%`;

                ctx.strokeStyle = boxColor;
                ctx.strokeRect(sx1, sy1, width, height);

                ctx.fillStyle = "rgba(2, 6, 23, 0.85)";
                const textWidth = ctx.measureText(label).width;
                ctx.fillRect(sx1, Math.max(0, sy1 - 24), textWidth + 10, 22);

                ctx.fillStyle = boxColor;
                ctx.fillText(label, sx1, Math.max(18, sy1 - 6));
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

            const sourceWidth = video.videoWidth;
            const sourceHeight = video.videoHeight;
            const desiredWidth = Math.min(sourceWidth, adaptiveCaptureWidthRef.current);
            const scale = Math.min(1, desiredWidth / sourceWidth);
            const targetWidth = Math.max(1, Math.round(sourceWidth * scale));
            const targetHeight = Math.max(1, Math.round(sourceHeight * scale));

            canvas.width = targetWidth;
            canvas.height = targetHeight;
            frameSizeRef.current = { width: targetWidth, height: targetHeight };

            const ctx = canvas.getContext("2d");
            if (!ctx) {
                return;
            }

            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const imageData = canvas.toDataURL("image/jpeg", JPEG_QUALITY);

            isRequestInFlight = true;
            const inferenceStartedAt = performance.now();

            try {
                const payload = await apiJson("/api/ai", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        imageData,
                        width: targetWidth,
                        height: targetHeight,
                        cameraId: currentCameraIdRef.current
                    })
                });
                const detections = Array.isArray(payload?.detections) ? payload.detections : [];
                drawDetections(detections);

                const inferenceMs = performance.now() - inferenceStartedAt;
                inferenceTimesRef.current.push(inferenceMs);
                if (inferenceTimesRef.current.length > 8) {
                    inferenceTimesRef.current.shift();
                }

                const avgInferenceMs = inferenceTimesRef.current.reduce((sum, ms) => sum + ms, 0) / inferenceTimesRef.current.length;
                if (avgInferenceMs > SLOW_INFERENCE_MS && adaptiveCaptureWidthRef.current > MIN_CAPTURE_WIDTH) {
                    adaptiveCaptureWidthRef.current = Math.max(MIN_CAPTURE_WIDTH, adaptiveCaptureWidthRef.current - CAPTURE_STEP);
                } else if (avgInferenceMs < FAST_INFERENCE_MS && adaptiveCaptureWidthRef.current < MAX_CAPTURE_WIDTH) {
                    adaptiveCaptureWidthRef.current = Math.min(MAX_CAPTURE_WIDTH, adaptiveCaptureWidthRef.current + Math.floor(CAPTURE_STEP / 2));
                }

                const now = Date.now();
                if (typeof onDetections === "function" && now - lastUiUpdateRef.current >= UI_UPDATE_INTERVAL_MS) {
                    onDetections({
                        detections,
                        frameWidth: targetWidth,
                        frameHeight: targetHeight,
                        timestamp: now,
                        cameraId: currentCameraIdRef.current,
                        vehicleSummary: payload?.vehicleSummary || null,
                        barrier: payload?.barrier || null
                    });
                    lastUiUpdateRef.current = now;
                }
            } catch (error) {
                console.error("Error sending frame to backend AI:", error);
            } finally {
                isRequestInFlight = false;
            }
        };

        const onResize = () => {
            syncOverlayCanvasSize();
        };

        let isDisposed = false;
        let timeoutId = null;

        const loopCapture = async () => {
            if (isDisposed) {
                return;
            }

            const startedAt = Date.now();
            await captureAndSend();
            const elapsed = Date.now() - startedAt;
            const delay = Math.max(0, MIN_CAPTURE_INTERVAL_MS - elapsed);
            timeoutId = window.setTimeout(loopCapture, delay);
        };

        window.addEventListener("resize", onResize);
        loopCapture();
        return () => {
            isDisposed = true;
            if (timeoutId !== null) {
                clearTimeout(timeoutId);
            }
            window.removeEventListener("resize", onResize);
        };
    }, [onDetections]);

    return (
        <div className="footage-panel">
            <div className="footage-toolbar">
                <div className="footage-camera-meta">
                    <div className="small">Current camera: {currentCamera.label}</div>
                    <div className="small">Traffic profile: {currentCamera.trafficLevel}</div>
                </div>
                <button type="button" onClick={handleNextCameraClick}>Next Camera</button>
            </div>

            <div
                className={`footage-wrap ${isZoomed ? "zoomed" : ""}`}
                onClick={handleToggleZoom}
                onMouseMove={handleMouseMove}
                title={isZoomed ? "Click to zoom out" : "Click to zoom in"}
            >
                <div
                    className="footage-zoom-layer"
                    style={{
                        transform: isZoomed ? `scale(${ZOOM_SCALE})` : "scale(1)",
                        transformOrigin: `${zoomOrigin.x}% ${zoomOrigin.y}%`
                    }}
                >
                    <video
                        key={activeVideoSrc}
                        ref={videoRef}
                        className="footage-video"
                        src={activeVideoSrc}
                        onError={handleVideoError}
                        loop
                        autoPlay
                        muted
                        playsInline
                    ></video>
                    <canvas ref={overlayCanvasRef} className="footage-overlay"></canvas>
                </div>
                <canvas ref={captureCanvasRef} hidden></canvas>
            </div>

            {sourceNotice ? <div className="footage-note small">{sourceNotice}</div> : null}
        </div>
    );
}

export default Footage;
