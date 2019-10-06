#!/bin/bash

if [[ $1 == "extract" ]]; then
  pybabel extract -F babel.cfg -o messages.pot .
elif [[ $1 == "init" ]]; then
  pybabel init -i messages.pot -d translations -l zh_Hans_CN
elif [[ $1 == "update" ]]; then
  pybabel update -i messages.pot -d translations
elif [[ $1 == "compile" ]]; then
  pybabel compile -d translations
elif [[ $1 == "json" ]]; then
  echo -n '{"wechatBackup": ' > static/translations/zh_Hans_CN.json
  pojson translations/zh_Hans_CN/LC_MESSAGES/messages.po >> static/translations/zh_Hans_CN.json
  echo "}" >> static/translations/zh_Hans_CN.json
  echo -n '{"wechatBackup": ' > static/translations/en.json
  pojson translations/en/LC_MESSAGES/messages.po >> static/translations/en.json
  echo "}" >> static/translations/en.json
fi


