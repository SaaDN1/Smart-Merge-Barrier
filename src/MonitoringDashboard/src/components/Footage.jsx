import { useEffect } from "react"
function Footage() {
    
    useEffect(() => {
        const interval = setInterval(() => {
            const video = document.querySelector("video")
            const canvas = document.querySelector("canvas")
            canvas.width = video.videoWidth
            canvas.height = video.videoHeight
            let ctx = canvas.getContext("2d")
            if(video) {
                ctx.drawImage(video, 0, 0)
                let frame = ctx.getImageData(0, 0, video.videoWidth, video.videoHeight)
                let data = frame.data
                const req = fetch("http://127.0.0.1:8000/", {
                    method: "POST",
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({data: Array.from(data)}),
                })
            }
            return () => clearInterval(interval)
        }, 5000)    
        
    }, [])

    return(
        <>
            <video src="public\videos\5927708-hd_1080_1920_30fps.mp4" height={"700px"} loop autoPlay muted></video>
            <canvas hidden></canvas>
            <a id='down_load' download='canvas.png' href="rand">click to download</a>
        </> 
    )
}

export default Footage