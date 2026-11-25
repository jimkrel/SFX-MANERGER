"""Exercise the downloader with a generated video served only on loopback."""
import functools
import os
import subprocess
import tempfile
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


def main():
    with tempfile.TemporaryDirectory() as directory:
        subprocess.run([
            "ffmpeg", "-nostdin", "-loglevel", "error", "-f", "lavfi", "-i",
            "color=size=160x120:rate=10", "-f", "lavfi", "-i", "sine=frequency=440",
            "-t", "1", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac",
            str(Path(directory) / "clip.mp4"),
        ], check=True)
        handler = functools.partial(SimpleHTTPRequestHandler, directory=directory)
        with ThreadingHTTPServer(("127.0.0.1", 0), handler) as server:
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                subprocess.run([
                    "cargo", "test", "--locked", "--manifest-path", "src-tauri/Cargo.toml",
                    "--no-default-features", "--test", "media", "downloader_local_fixture",
                    "--", "--ignored", "--exact",
                ], check=True, env={**os.environ, "SFX_FIXTURE_URL":
                    f"http://127.0.0.1:{server.server_port}/clip.mp4"})
            finally:
                server.shutdown()
                thread.join()


if __name__ == "__main__":
    main()
