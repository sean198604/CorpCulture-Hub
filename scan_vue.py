import re

with open(r'C:\Users\Administrator\Documents\Github\CorpCulture-Hub\dist\assets\app-BZnVoREw.js', 'r', encoding='utf-8', errors='ignore') as f:
    js = f.read()

# 找 addProject 函数体，理解 project 结构
m = re.search(r'addProject\([^)]*\)\s*\{', js)
if m:
    print("=== addProject 函数 ===")
    print(js[m.start():m.start()+600])
    print()

# 找项目创建/保存的结构 (name:...type:...startDate...)
m2 = re.search(r'\{name:[^}]*startDate[^}]*\}', js)
if m2:
    print("=== project 对象结构示例 ===")
    print(js[m2.start():m2.start()+400])
    print()

# 找 phases 结构
m3 = re.search(r'phases:\[[^\]]*\]', js)
if m3:
    print("=== phases 结构 ===")
    print(js[m3.start():m3.start()+300])
    print()

# 找 status 枚举
m4 = re.search(r'statusPending[^,}]*', js)
if m4:
    print("=== status 枚举 ===")
    print(js[m4.start()-200:m4.start()+200])
