"""Optional rebuild: python build_agent.py [path/to/javac]. Requires JDK 9+."""
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import zipfile

root = Path(__file__).resolve().parent
compiler = sys.argv[1] if len(sys.argv) > 1 else shutil.which("javac")
if not compiler:
    raise SystemExit("找不到 javac；請指定 JDK 9 或以上版本的 javac 完整路徑。")
with tempfile.TemporaryDirectory() as directory:
    classes = Path(directory)
    subprocess.run([compiler, "--release", "8", "-encoding", "UTF-8", "-d", directory,
                    str(root / "OxoResourceAgent.java")], check=True)
    with zipfile.ZipFile(root / "oxo-resource-agent.jar", "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("META-INF/MANIFEST.MF",
                         "Manifest-Version: 1.0\r\nPremain-Class: oxocraft.OxoResourceAgent\r\n\r\n")
        for path in sorted(classes.rglob("*.class")):
            archive.write(path, path.relative_to(classes).as_posix())
print("已建立：", root / "oxo-resource-agent.jar")
