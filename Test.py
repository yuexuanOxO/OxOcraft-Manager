tests = [
    "",
    "   ",
    "#hello",
    "resource-pack=",
    "server-port=25565",
    "motd=OxO=Server"
]

# for x in tests:
#     stripped = x.strip()
#     print(x, "=>", not stripped, stripped.startswith("#"))




key,value = tests[5].split("=",1)


print(key)
print(value)
# print(value2)