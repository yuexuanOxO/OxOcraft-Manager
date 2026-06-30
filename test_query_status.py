import socket

HOST = "127.0.0.1"
PORT = 25565

try:
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.settimeout(3)

    # Query handshake
    session_id = 1
    packet = b"\xfe\xfd\x09" + session_id.to_bytes(4, "big")

    sock.sendto(packet, (HOST, PORT))

    data, _ = sock.recvfrom(4096)

    print("Query 已啟用")
    print(data.hex())

except socket.timeout:
    print("Query 無回應")

except Exception as e:
    print("Query 連線失敗：", e)

finally:
    sock.close()