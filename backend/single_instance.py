"""Windows startup guard shared by source and packaged launches."""
import ctypes
import sys
from ctypes import wintypes


def claim_instance():
    if sys.platform != "win32":
        return True

    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    create = kernel.CreateMutexW
    create.argtypes = (ctypes.c_void_p, wintypes.BOOL, wintypes.LPCWSTR)
    create.restype = wintypes.HANDLE
    ctypes.set_last_error(0)
    handle = create(None, False, r"Local\OxOcraft-Manager.SingleInstance")
    error = ctypes.get_last_error()
    if not handle:
        raise ctypes.WinError(error)
    if error == 183:  # ERROR_ALREADY_EXISTS
        close = kernel.CloseHandle
        close.argtypes = (wintypes.HANDLE,)
        close.restype = wintypes.BOOL
        close(handle)
        return False

    # Keep this kernel handle open until Windows tears down this process.
    return True


def show_duplicate_notice():
    import tkinter as tk

    root = tk.Tk()
    root.withdraw()
    root.title("OxOcraft-Manager 開啟失敗")
    root.configure(bg="#202020", padx=32, pady=24)
    root.resizable(False, False)
    for message, color, size in (
        ("OxOcraft-Manager 開啟失敗", "#ff6666", 16),
        ("OxOcraft-Manager 已在執行中，請使用原本的管理視窗。", "#eeeeee", 11),
        ("點擊空白處關閉此提示。", "#bbbbbb", 10),
    ):
        tk.Label(root, text=message, fg=color, bg="#202020",
                 font=("Microsoft JhengHei UI", size)).pack(pady=5)

    # The toplevel binding also receives clicks on its labels.
    root.bind("<Button-1>", lambda event: root.destroy())
    root.bind("<Escape>", lambda event: root.destroy())
    root.update_idletasks()
    x = max(0, (root.winfo_screenwidth() - root.winfo_reqwidth()) // 2)
    y = max(0, (root.winfo_screenheight() - root.winfo_reqheight()) // 2)
    root.geometry(f"+{x}+{y}")
    root.deiconify()
    root.lift()
    root.mainloop()
