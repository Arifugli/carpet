import {test} from 'node:test';
import assert from 'node:assert/strict';
import {dictionaries,setLocale,t,money,text,localizedName} from '../public/i18n.js';
import reports from '../config/reports.json' with {type:'json'};

test('i18n: весь русский интерфейс имеет узбекский перевод; названия и пояснения отчётов переведены',()=>{
 assert.deepEqual(Object.keys(dictionaries.uz).sort(),Object.keys(dictionaries.ru).sort());
 for(const [key,value]of Object.entries(dictionaries.uz)){assert.ok(value.trim(),key);assert.doesNotMatch(value,/[А-Яа-яЁё]/,key);}
 try{
  assert.equal(setLocale('uz'),true);assert.equal(t('login'),'Kirish');assert.match(money(50000),/so‘m/);
  assert.equal(localizedName({name_ru:'Фергана',name_uz:'Farg‘ona'}),'Farg‘ona');
  for(const report of Object.values(reports))for(const value of [report.title,report.note,...report.columns.map(c=>c[1]),...report.totals.map(c=>c[1])])assert.doesNotMatch(text(value),/[А-Яа-яЁё]/,value);
  assert.equal(text('Мойка и сушка завершены; передал на упаковку'),'Yuvish va quritish tugadi; qadoqlashga topshirdim');
  assert.equal(setLocale('unknown'),false);assert.equal(t('login'),'Kirish');
  assert.equal(text('Custom client note'),'Custom client note');
 }finally{setLocale('ru');}
});
