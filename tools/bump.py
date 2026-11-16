#!/usr/bin/env python3
"""배포 전에 실행: 모든 CSS/JS 주소 뒤의 ?v=번호를 새 번호로 바꿔 브라우저가 옛 파일을 캐시에서 꺼내 쓰지 않게 한다."""
import re, time, pathlib

root = pathlib.Path(__file__).resolve().parent.parent
version = str(int(time.time()))
pattern = re.compile(r'((?:css|js)/[\w.-]+\.(?:css|js)|\./[\w.-]+\.js)(\?v=\d+)?(?=["\'])')

for path in [*root.glob('*.html'), *root.glob('js/*.js')]:
    text = path.read_text(encoding='utf-8')
    new = pattern.sub(lambda m: f'{m.group(1)}?v={version}', text)
    if new != text:
        path.write_text(new, encoding='utf-8')
print('version', version)
