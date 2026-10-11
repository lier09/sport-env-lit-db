# 摘要与单位字段生成规范

`daily_update.py` 的 `split_shards()` 应保存完整 abstract，不得使用 `[:500]`。
移除巨大 `_authorships` 前，把其中 institutions[].display_name 提取到精简 `affiliations` 字符串数组。
前端已支持此字段，同时兼容包含原始 `_authorships` 的数据。

用户提供的脚本已在本机修改，修正版单独交付。
线上单位数据仍需要持有最新 merged.json 和 Supabase 上传环境的一方重新生成分片。
此次前端部署不改写主库数据，也不声称已补齐单位字段。
