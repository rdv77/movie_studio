import type {Job} from './domain';

export const waitLimitMs=(j:Job)=>(j.kind==='video'?45:15)*60*1000;
export function waitExpired(j:Job,time=Date.now()) {
  const start=Date.parse(j.waitStartedAt??j.started??'');
  return ['dispatching','pending','saving'].includes(j.status)&&Number.isFinite(start)&&time-start>=waitLimitMs(j);
}
export function stopJobWait(j:Job,reason:'manual'|'timeout'|'saving',time=new Date().toISOString()) {
  if(!['dispatching','pending','saving'].includes(j.status))throw Error('Эта попытка уже не ожидает результата.');
  j.resumeStatus=j.output?.url?'saving':j.status==='pending'&&j.requestId?'pending':undefined;
  j.waitStoppedAt=time;j.waitStopReason=reason;j.status='unknown';
  if(reason!=='saving')j.error=reason==='manual'?'Ожидание остановлено пользователем. Запрос у провайдера мог продолжить работу; списание не отменено.':'Превышено время ожидания. Очередь освобождена. Новая генерация не отправлена; исход и списание нужно проверить.';
}
export function resumeJobWait(j:Job) {
  if(!j.waitStoppedAt||j.status!=='unknown'||!j.resumeStatus)throw Error('Нет сохранённой ссылки или запроса для безопасной проверки. Проверьте исход в кабинете провайдера; новая генерация не отправлена.');
  if(j.resumeStatus==='saving'?!j.output?.url:!j.requestId)throw Error('Не найден адрес результата или идентификатор запроса.');
  j.status=j.resumeStatus;j.waitStartedAt=new Date().toISOString();j.waitStoppedAt=undefined;j.waitStopReason=undefined;j.saveFailures=0;j.error=undefined;
}
