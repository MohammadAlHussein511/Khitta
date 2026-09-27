/* core/i18n.js — Arabic-first catalogue + English twin, RTL and Western (Latin) digits.
 *
 * All date/time formatting is done by hand rather than through Intl so that the output is
 * identical on Android's ICU, on a desktop browser during QC, and in Node tests — and so that
 * Arabic can never silently switch to Arabic-Indic digits (٠١٢٣).
 */
(function (root, factory) {
  var K = root.K = root.K || {};
  var api = factory(K.util, K.date);
  K.i18n = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (U, D) {
  'use strict';

  var MONTHS = {
    ar: ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'],
    en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
  };
  var MONTHS_SHORT = {
    ar: ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'],
    en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  };
  // keyed by ISO day number (1 = Monday … 7 = Sunday)
  var DOW = {
    ar: { 1: 'الاثنين', 2: 'الثلاثاء', 3: 'الأربعاء', 4: 'الخميس', 5: 'الجمعة', 6: 'السبت', 7: 'الأحد' },
    en: { 1: 'Monday', 2: 'Tuesday', 3: 'Wednesday', 4: 'Thursday', 5: 'Friday', 6: 'Saturday', 7: 'Sunday' }
  };
  var DOW_SHORT = {
    ar: { 1: 'اثنين', 2: 'ثلاثاء', 3: 'أربعاء', 4: 'خميس', 5: 'جمعة', 6: 'سبت', 7: 'أحد' },
    en: { 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat', 7: 'Sun' }
  };

  var AR = {
    'app.name': 'خِطّة',
    'app.tagline': 'مصفوفة آيزنهاور',

    'nav.matrix': 'المصفوفة',
    'nav.week': 'الأسبوع',
    'nav.stats': 'الإحصاءات',
    'nav.settings': 'الإعدادات',

    'topbar.today': 'اليوم {date}',

    'matrix.axis.urgent': 'عاجل',
    'matrix.axis.notUrgent': 'غير عاجل',
    'matrix.axis.important': 'مهم',
    'matrix.axis.notImportant': 'غير مهم',
    'matrix.q1.name': 'أنجزها الآن',
    'matrix.q1.sub': 'مهم · عاجل',
    'matrix.q2.name': 'خطّط لها',
    'matrix.q2.sub': 'مهم · غير عاجل',
    'matrix.q3.name': 'فوّضها',
    'matrix.q3.sub': 'غير مهم · عاجل',
    'matrix.q4.name': 'استغنِ عنها',
    'matrix.q4.sub': 'غير مهم · غير عاجل',
    'matrix.empty': 'لا مهام هنا',
    'matrix.emptyCta': 'اضغط + لإضافة مهمة إلى هذا الربع',
    'matrix.hint': 'اضغط مطولًا واسحب للترتيب، أو اسحب المهمة لربع آخر',
    'matrix.openCount': '{n} مهمة مفتوحة',

    'week.today': 'اليوم',
    'week.prev': 'الأسبوع السابق',
    'week.next': 'الأسبوع التالي',
    'week.pending': 'قيد الإنجاز',
    'week.done': 'مكتملة',
    'week.noTasks': 'لا شيء مجدول في هذا اليوم',
    'week.noTasksCta': 'أضف مهمة لهذا اليوم',
    'week.allDone': 'أنجزت كل مهام هذا اليوم 🎉',
    'week.summary': '{pending} متبقية · {done} منجزة',
    'week.addOn': 'إضافة في {day}',
    'week.overdueIn': '{n} متأخرة',
    'week.jumpToday': 'العودة إلى اليوم',
    'week.rescheduled': 'نُقلت المهمة إلى {day}',
    'week.rescheduledSeries': 'نُقلت سلسلة التكرار إلى {day}',
    'week.dragHint': 'اسحب مهمة إلى يوم لتغيير موعدها',
    'week.readonly': 'يوم للقراءة فقط',
    'week.viewList': 'عرض قائمة',
    'week.viewGrid': 'عرض جدول',
    'sort.label': 'الترتيب',
    'sort.manual': 'يدوي',
    'sort.time': 'حسب الوقت',
    'sort.quadrant': 'حسب التصنيف',
    'sort.created': 'حسب الإضافة',
    'sort.lockedHint': 'الترتيب اليدوي فقط هو الذي يسمح بالسحب',
    'past.title': 'هذا اليوم صار تاريخًا',
    'past.body': 'تعلّم من الماضي، وركّز على اليوم، وابدأ الآن. الأيام السابقة للعرض والتأمل فقط.',

    'stats.hero.title': 'نسبة الإنجاز',
    'stats.hero.window': 'آخر {n} يومًا',
    'stats.hero.done': 'منجزة',
    'stats.hero.of': 'من {n} مجدولة',
    'stats.fact.today': 'إنجاز اليوم',
    'stats.fact.open': 'مهام مفتوحة',
    'stats.quad.title': 'توزيع المهام',
    'stats.quad.done30': 'أُنجز {n} خلال 30 يومًا',
    'stats.quad.none': 'لا مهام',
    'stats.chart.title': 'نشاط آخر 7 أيام',
    'stats.chart.done': 'إنجاز',
    'stats.chart.created': 'إضافة',
    'stats.tile.overdue': 'مهام متأخرة',
    'stats.tile.today': 'مطلوبة اليوم',
    'stats.tile.next7': 'خلال 7 أيام',
    'stats.tile.streak': 'أيام متتالية',
    'stats.tile.streakBest': 'أفضل سلسلة: {n}',
    'stats.tile.streakNone': 'أنجز مهمة اليوم لبدء السلسلة',
    'stats.empty': 'لا توجد بيانات بعد — أضف أول مهمة',

    'editor.new': 'مهمة جديدة',
    'editor.edit': 'تعديل المهمة',
    'editor.title': 'العنوان',
    'editor.titlePh': 'ماذا تريد أن تنجز؟',
    'editor.notes': 'ملاحظات',
    'editor.notesPh': 'تفاصيل اختيارية…',
    'editor.quadrant': 'التصنيف',
    'editor.when': 'الموعد',
    'editor.date': 'التاريخ',
    'editor.time': 'الوقت',
    'editor.quick.today': 'اليوم',
    'editor.quick.tomorrow': 'غدًا',
    'editor.quick.nextWeek': 'الأسبوع القادم',
    'editor.quick.pick': 'اختر تاريخًا',
    'editor.repeat': 'التكرار',
    'editor.repeatEnd': 'نهاية التكرار',
    'editor.reminder': 'التذكير',
    'editor.untimed': 'بدون وقت محدد',
    'editor.untimedDesc': 'هدف بتاريخ فقط — لا يُعد متأخرًا إلا بانتهاء يومه',
    'editor.untimedNoRemind': 'الأهداف بدون وقت محدد لا تحمل تنبيهات نظامية',
    'editor.reminderOn': 'تنبيه على مستوى النظام',
    'editor.reminderOff': 'بدون تنبيه',
    'editor.remindBefore': 'قبل الموعد بـ',
    'editor.nextOccurrences': 'المواعيد القادمة',
    'editor.save': 'حفظ',
    'editor.saveNew': 'إضافة',
    'editor.cancel': 'إلغاء',
    'editor.delete': 'حذف',
    'editor.closeSeries': 'إنهاء التكرار',
    'editor.errorTitle': 'اكتب عنوانًا للمهمة',
    'editor.errorDue': 'حدّد تاريخًا ووقتًا',
    'editor.deleted': 'حُذفت المهمة',

    'repeat.none': 'بدون تكرار',
    'repeat.daily': 'يومي',
    'repeat.monthly': 'شهري',
    'repeat.everyDays': 'كل كم يوم؟',
    'repeat.everyMonths': 'كل كم شهر؟',
    'repeat.dayOfMonth': 'في أي يوم من الشهر؟',
    'repeat.dayOfMonthAuto': 'تلقائي (يوم الموعد)',
    'repeat.desc.daily1': 'يوميًا',
    'repeat.desc.daily2': 'كل يومين',
    'repeat.desc.dailyN': 'كل {n} أيام',
    'repeat.desc.dailyMany': 'كل {n} يومًا',
    'repeat.desc.monthly1': 'شهريًا',
    'repeat.desc.monthly2': 'كل شهرين',
    'repeat.desc.monthlyN': 'كل {n} أشهر',
    'repeat.desc.monthlyMany': 'كل {n} شهرًا',
    'repeat.desc.dayOfMonth': ' · يوم {d}',
    'repeat.weekly': 'أسبوعي',
    'repeat.pickDays': 'اختر أيام الأسبوع',
    'repeat.weekInterval': 'كل كم أسبوع؟',
    'repeat.desc.weekly1': 'أسبوعيًا',
    'repeat.desc.weekly2': 'كل أسبوعين',
    'repeat.desc.weeklyN': 'كل {n} أسابيع',
    'repeat.desc.weeklyMany': 'كل {n} أسبوع',
    'repeat.desc.weeklyDays': ' · {days}',

    'end.never': 'بلا نهاية',
    'end.count': 'بعد عدد مرات',
    'end.date': 'حتى تاريخ',
    'end.countLabel': 'عدد المرات',
    'end.dateLabel': 'تاريخ الانتهاء',
    'end.count1': 'مرة واحدة',
    'end.count2': 'مرتين',
    'end.countN': '{n} مرات',
    'end.countMany': '{n} مرة',

    'offset.at': 'عند الموعد',
    'offset.5': 'قبل 5 دقائق',
    'offset.10': 'قبل 10 دقائق',
    'offset.30': 'قبل 30 دقيقة',
    'offset.60': 'قبل ساعة',
    'offset.180': 'قبل 3 ساعات',
    'offset.1440': 'قبل يوم',

    'task.done': 'تم الإنجاز',
    'task.undo': 'تراجع',
    'task.undone': 'أُعيدت المهمة إلى القائمة',
    'task.completed': 'أحسنت! تم الإنجاز',
    'task.edit': 'تعديل',
    'task.delete': 'حذف',
    'task.deleteConfirmTitle': 'حذف المهمة؟',
    'task.deleteConfirmBody': 'سيُحذف «{title}» وكل تكراراته وإشعاراته. لا يمكن التراجع.',
    'task.seriesClosed': 'أُنهيت سلسلة التكرار',
    'task.saved': 'حُفظت المهمة',
    'task.moved': 'نُقلت إلى {quad}',
    'task.reordered': 'تم إعادة الترتيب',
    'task.overdue': 'متأخرة',
    'task.dueToday': 'اليوم {time}',
    'task.dueTomorrow': 'غدًا {time}',
    'task.repeating': 'مكرّرة',
    'task.noDue': 'بدون موعد',
    'task.untimed': 'بدون وقت',

    'settings.appearance': 'المظهر',
    'settings.palette': 'ألوان المصفوفة',
    'settings.paletteDesc': 'لون كل تصنيف في المصفوفة وشارات القوائم',
    'settings.tagStyle': 'نمط الشارات',
    'tagStyle.soft': 'ناعم',
    'tagStyle.vivid': 'صارخ',
    'tagStyle.outline': 'محيط',
    'settings.tagAlpha': 'شفافية خلفية الشارة',
    'settings.theme': 'السمة',
    'settings.theme.system': 'تلقائي',
    'settings.theme.light': 'فاتح',
    'settings.theme.dark': 'داكن',
    'settings.language': 'اللغة',
    'settings.language.desc': 'العربية مع دعم كامل للاتجاه من اليمين إلى اليسار',
    'settings.notifications': 'التذكيرات',
    'settings.remindersOn': 'تفعيل التذكيرات',
    'settings.remindersOn.desc': 'إشعارات على مستوى النظام تصلك حتى لو كان التطبيق مغلقًا',
    'settings.notifPermission': 'إذن الإشعارات',
    'settings.notifPermission.granted': 'ممنوح',
    'settings.notifPermission.denied': 'غير ممنوح — لن تصلك التذكيرات',
    'settings.notifPermission.grant': 'منح الإذن',
    'settings.exactAlarms': 'دقة المواعيد',
    'settings.exactAlarms.ok': 'التنبيهات الدقيقة مفعّلة',
    'settings.exactAlarms.no': 'غير مفعّلة — قد يتأخر التذكير حتى دقيقة',
    'settings.exactAlarms.fix': 'تفعيل',
    'settings.armed': 'إشعارات مجدولة',
    'settings.armed.desc': '{n} تنبيه مسجّل في النظام',
    'settings.test': 'إرسال تذكير تجريبي',
    'settings.test.desc': 'يظهر فورًا للتأكد من عمل الإشعارات',
    'settings.defaultOffset': 'الوقت الافتراضي للتنبيه',
    'settings.week': 'الأسبوع',
    'settings.weekStart': 'بداية الأسبوع',
    'settings.weekStart.6': 'السبت',
    'settings.weekStart.7': 'الأحد',
    'settings.weekStart.1': 'الاثنين',
    'settings.horizon': 'أفق الجدولة',
    'settings.horizon.desc': 'كم يومًا للأمام تُسجَّل التذكيرات في النظام',
    'settings.horizon.value': '{n} يومًا',
    'settings.data': 'البيانات',
    'settings.clearDone': 'حذف المهام المكتملة',
    'settings.clearDone.desc': 'يزيل {n} مهمة منتهية',
    'settings.storage': 'حجم البيانات',
    'settings.about': 'حول التطبيق',
    'settings.version': 'الإصدار',
    'settings.device': 'الجهاز',
    'settings.privacy': 'لا إنترنت، لا حسابات، لا تتبّع — بياناتك محفوظة على جهازك فقط.',
    'settings.tasksCount': '{n} مهمة',

    'confirm.clearDone.title': 'حذف المهام المكتملة؟',
    'confirm.clearDone.body': 'سيُحذف {n} مهمة منتهية. المهام المفتوحة تبقى كما هي.',
    'confirm.delete': 'حذف',
    'confirm.cancel': 'إلغاء',
    'confirm.ok': 'موافق',

    'toast.cleared': 'حُذفت {n} مهمة مكتملة',
    'toast.remindersOff': 'التذكيرات متوقفة',
    'toast.needPermission': 'يلزم إذن الإشعارات أولًا',
    'toast.testSent': 'أُرسل التذكير التجريبي',
    'toast.langChanged': 'Language switched to English',

    'onb.title': 'أهلًا بك في خِطّة',
    'onb.body': 'صنّف مهامك حسب الأهمية والاستعجال، وخطّط أسبوعك من السبت إلى الجمعة، ودع النظام يذكّرك في الموعد حتى لو كان التطبيق مغلقًا.',
    'onb.item1.t': 'أربعة أرباع',
    'onb.item1.d': 'أنجزها الآن · خطّط لها · فوّضها · استغنِ عنها',
    'onb.item2.t': 'أسبوعك بالسبت',
    'onb.item2.d': 'عرض أسبوعي مع فصل واضح بين قيد الإنجاز والمكتمل',
    'onb.item3.t': 'تذكيرات حقيقية',
    'onb.item3.d': 'تنبيهات على مستوى النظام، مع تكرار يومي وشهري',
    'onb.notifTitle': 'فعّل التنبيهات',
    'onb.notifBody': 'بدون هذا الإذن لن تصلك التذكيرات على Android 13 وأحدث.',
    'onb.allow': 'سماح',
    'onb.later': 'لاحقًا',
    'onb.start': 'ابدأ',

    'notif.test.title': 'تذكير تجريبي',
    'notif.test.body': 'إن وصلك هذا الإشعار فالتذكيرات تعمل بشكل صحيح ✅',
    'notif.body': '{when} · {quad}',
    'notif.open': 'فتح',
    'notif.done': 'تم الإنجاز',
    'notif.snooze': 'غفوة 10 د',

    'time.now': 'الآن',
    'time.inMinutes': 'بعد {n} دقيقة',
    'time.inHours': 'بعد {n} ساعة',
    'time.inDays': 'بعد {n} يوم',
    'time.agoMinutes': 'منذ {n} دقيقة',
    'time.agoHours': 'منذ {n} ساعة',
    'time.agoDays': 'منذ {n} يوم',
    'time.overdueBy': 'متأخرة {dur}',

    'a11y.close': 'إغلاق',
    'a11y.dragHandle': 'اسحب لإعادة الترتيب',
    'a11y.toggleDone': 'تبديل حالة الإنجاز',
    'a11y.more': 'خيارات إضافية'
  };

  var EN = {
    'app.name': 'Khitta',
    'app.tagline': 'Eisenhower Matrix',

    'nav.matrix': 'Matrix',
    'nav.week': 'Week',
    'nav.stats': 'Stats',
    'nav.settings': 'Settings',

    'topbar.today': 'Today, {date}',

    'matrix.axis.urgent': 'Urgent',
    'matrix.axis.notUrgent': 'Not urgent',
    'matrix.axis.important': 'Important',
    'matrix.axis.notImportant': 'Not important',
    'matrix.q1.name': 'Do now',
    'matrix.q1.sub': 'Important · urgent',
    'matrix.q2.name': 'Schedule',
    'matrix.q2.sub': 'Important · not urgent',
    'matrix.q3.name': 'Delegate',
    'matrix.q3.sub': 'Urgent · not important',
    'matrix.q4.name': 'Eliminate',
    'matrix.q4.sub': 'Neither · nor',
    'matrix.empty': 'Nothing here',
    'matrix.emptyCta': 'Tap + to add a task to this quadrant',
    'matrix.hint': 'Long-press and drag to reorder, or drag a task into another quadrant',
    'matrix.openCount': '{n} open tasks',

    'week.today': 'Today',
    'week.prev': 'Previous week',
    'week.next': 'Next week',
    'week.pending': 'Pending',
    'week.done': 'Completed',
    'week.noTasks': 'Nothing scheduled for this day',
    'week.noTasksCta': 'Add a task for this day',
    'week.allDone': 'Everything done for this day 🎉',
    'week.summary': '{pending} pending · {done} done',
    'week.addOn': 'Add on {day}',
    'week.overdueIn': '{n} overdue',
    'week.jumpToday': 'Jump to today',
    'week.rescheduled': 'Moved to {day}',
    'week.rescheduledSeries': 'Repeating series moved to {day}',
    'week.dragHint': 'Drag a task onto a day to reschedule it',
    'week.readonly': 'Read-only day',
    'week.viewList': 'List view',
    'week.viewGrid': 'Table view',
    'sort.label': 'Sort',
    'sort.manual': 'Manual',
    'sort.time': 'By time',
    'sort.quadrant': 'By quadrant',
    'sort.created': 'By added',
    'sort.lockedHint': 'Only manual sorting allows dragging',
    'past.title': 'That day is history now',
    'past.body': 'Learn from the past, focus on today, begin now. Past days are read-only, for reflection.',

    'stats.hero.title': 'Completion rate',
    'stats.hero.window': 'Last {n} days',
    'stats.hero.done': 'completed',
    'stats.hero.of': 'of {n} scheduled',
    'stats.fact.today': 'Done today',
    'stats.fact.open': 'Open tasks',
    'stats.quad.title': 'Task distribution',
    'stats.quad.done30': '{n} completed in 30 days',
    'stats.quad.none': 'No tasks',
    'stats.chart.title': 'Last 7 days',
    'stats.chart.done': 'Done',
    'stats.chart.created': 'Added',
    'stats.tile.overdue': 'Overdue',
    'stats.tile.today': 'Due today',
    'stats.tile.next7': 'Next 7 days',
    'stats.tile.streak': 'Day streak',
    'stats.tile.streakBest': 'Best: {n}',
    'stats.tile.streakNone': 'Complete something today to start a streak',
    'stats.empty': 'No data yet — add your first task',

    'editor.new': 'New task',
    'editor.edit': 'Edit task',
    'editor.title': 'Title',
    'editor.titlePh': 'What do you want to get done?',
    'editor.notes': 'Notes',
    'editor.notesPh': 'Optional details…',
    'editor.quadrant': 'Quadrant',
    'editor.when': 'When',
    'editor.date': 'Date',
    'editor.time': 'Time',
    'editor.quick.today': 'Today',
    'editor.quick.tomorrow': 'Tomorrow',
    'editor.quick.nextWeek': 'Next week',
    'editor.quick.pick': 'Pick a date',
    'editor.repeat': 'Repeat',
    'editor.repeatEnd': 'Repeat ends',
    'editor.reminder': 'Reminder',
    'editor.untimed': 'No specific time',
    'editor.untimedDesc': 'A goal with a date only — never overdue until its day ends',
    'editor.untimedNoRemind': 'Untimed goals carry no system notifications',
    'editor.reminderOn': 'System-level notification',
    'editor.reminderOff': 'No notification',
    'editor.remindBefore': 'Notify before',
    'editor.nextOccurrences': 'Upcoming',
    'editor.save': 'Save',
    'editor.saveNew': 'Add task',
    'editor.cancel': 'Cancel',
    'editor.delete': 'Delete',
    'editor.closeSeries': 'End repetition',
    'editor.errorTitle': 'Please enter a title',
    'editor.errorDue': 'Please pick a date and time',
    'editor.deleted': 'Task deleted',

    'repeat.none': 'Does not repeat',
    'repeat.daily': 'Daily',
    'repeat.monthly': 'Monthly',
    'repeat.everyDays': 'Every how many days?',
    'repeat.everyMonths': 'Every how many months?',
    'repeat.dayOfMonth': 'On which day of the month?',
    'repeat.dayOfMonthAuto': 'Automatic (the due day)',
    'repeat.desc.daily1': 'Every day',
    'repeat.desc.daily2': 'Every 2 days',
    'repeat.desc.dailyN': 'Every {n} days',
    'repeat.desc.dailyMany': 'Every {n} days',
    'repeat.desc.monthly1': 'Every month',
    'repeat.desc.monthly2': 'Every 2 months',
    'repeat.desc.monthlyN': 'Every {n} months',
    'repeat.desc.monthlyMany': 'Every {n} months',
    'repeat.desc.dayOfMonth': ' · day {d}',
    'repeat.weekly': 'Weekly',
    'repeat.pickDays': 'Pick the weekdays',
    'repeat.weekInterval': 'Every how many weeks?',
    'repeat.desc.weekly1': 'Every week',
    'repeat.desc.weekly2': 'Every 2 weeks',
    'repeat.desc.weeklyN': 'Every {n} weeks',
    'repeat.desc.weeklyMany': 'Every {n} weeks',
    'repeat.desc.weeklyDays': ' · {days}',

    'end.never': 'Never ends',
    'end.count': 'After a number of times',
    'end.date': 'Until a date',
    'end.countLabel': 'Number of times',
    'end.dateLabel': 'End date',
    'end.count1': 'Once',
    'end.count2': 'Twice',
    'end.countN': '{n} times',
    'end.countMany': '{n} times',

    'offset.at': 'At the due time',
    'offset.5': '5 minutes before',
    'offset.10': '10 minutes before',
    'offset.30': '30 minutes before',
    'offset.60': '1 hour before',
    'offset.180': '3 hours before',
    'offset.1440': '1 day before',

    'task.done': 'Mark done',
    'task.undo': 'Undo',
    'task.undone': 'Task moved back to the list',
    'task.completed': 'Nice — marked as done',
    'task.edit': 'Edit',
    'task.delete': 'Delete',
    'task.deleteConfirmTitle': 'Delete this task?',
    'task.deleteConfirmBody': '“{title}” and all of its occurrences and notifications will be removed. This cannot be undone.',
    'task.seriesClosed': 'Repetition ended',
    'task.saved': 'Task saved',
    'task.moved': 'Moved to {quad}',
    'task.reordered': 'Order updated',
    'task.overdue': 'Overdue',
    'task.dueToday': 'Today {time}',
    'task.dueTomorrow': 'Tomorrow {time}',
    'task.repeating': 'Repeating',
    'task.noDue': 'No due date',
    'task.untimed': 'Untimed',

    'settings.appearance': 'Appearance',
    'settings.palette': 'Matrix colours',
    'settings.paletteDesc': 'A colour per classification, in the matrix and in list tags',
    'settings.tagStyle': 'Tag style',
    'tagStyle.soft': 'Soft',
    'tagStyle.vivid': 'Vivid',
    'tagStyle.outline': 'Outline',
    'settings.tagAlpha': 'Tag background opacity',
    'settings.theme': 'Theme',
    'settings.theme.system': 'System',
    'settings.theme.light': 'Light',
    'settings.theme.dark': 'Dark',
    'settings.language': 'Language',
    'settings.language.desc': 'Arabic, with full right-to-left layout',
    'settings.notifications': 'Reminders',
    'settings.remindersOn': 'Enable reminders',
    'settings.remindersOn.desc': 'System-level alerts that reach you even when the app is closed',
    'settings.notifPermission': 'Notification permission',
    'settings.notifPermission.granted': 'Granted',
    'settings.notifPermission.denied': 'Not granted — reminders will not appear',
    'settings.notifPermission.grant': 'Grant',
    'settings.exactAlarms': 'Exact timing',
    'settings.exactAlarms.ok': 'Exact alarms are on',
    'settings.exactAlarms.no': 'Off — a reminder may be up to a minute late',
    'settings.exactAlarms.fix': 'Enable',
    'settings.armed': 'Scheduled notifications',
    'settings.armed.desc': '{n} alarms registered with the system',
    'settings.test': 'Send a test reminder',
    'settings.test.desc': 'Fires immediately so you can confirm notifications work',
    'settings.defaultOffset': 'Default reminder lead time',
    'settings.week': 'Week',
    'settings.weekStart': 'Week starts on',
    'settings.weekStart.6': 'Saturday',
    'settings.weekStart.7': 'Sunday',
    'settings.weekStart.1': 'Monday',
    'settings.horizon': 'Scheduling horizon',
    'settings.horizon.desc': 'How many days ahead reminders are registered with the system',
    'settings.horizon.value': '{n} days',
    'settings.data': 'Data',
    'settings.clearDone': 'Clear completed tasks',
    'settings.clearDone.desc': 'Removes {n} finished tasks',
    'settings.storage': 'Storage used',
    'settings.about': 'About',
    'settings.version': 'Version',
    'settings.device': 'Device',
    'settings.privacy': 'No internet, no accounts, no tracking — your data stays on this device.',
    'settings.tasksCount': '{n} tasks',

    'confirm.clearDone.title': 'Clear completed tasks?',
    'confirm.clearDone.body': '{n} finished tasks will be removed. Open tasks are untouched.',
    'confirm.delete': 'Delete',
    'confirm.cancel': 'Cancel',
    'confirm.ok': 'OK',

    'toast.cleared': 'Cleared {n} completed tasks',
    'toast.remindersOff': 'Reminders are off',
    'toast.needPermission': 'Notification permission is needed first',
    'toast.testSent': 'Test reminder sent',
    'toast.langChanged': 'تم التبديل إلى العربية',

    'onb.title': 'Welcome to Khitta',
    'onb.body': 'Sort tasks by importance and urgency, plan a Saturday-to-Friday week, and let the system remind you on time — even when the app is closed.',
    'onb.item1.t': 'Four quadrants',
    'onb.item1.d': 'Do now · Schedule · Delegate · Eliminate',
    'onb.item2.t': 'A Saturday-first week',
    'onb.item2.d': 'Weekly view with a clear split between pending and completed',
    'onb.item3.t': 'Real reminders',
    'onb.item3.d': 'System-level notifications with daily and monthly repetition',
    'onb.notifTitle': 'Turn on notifications',
    'onb.notifBody': 'Without this permission reminders cannot appear on Android 13+.',
    'onb.allow': 'Allow',
    'onb.later': 'Later',
    'onb.start': 'Get started',

    'notif.test.title': 'Test reminder',
    'notif.test.body': 'If you can see this, reminders are working ✅',
    'notif.body': '{when} · {quad}',
    'notif.open': 'Open',
    'notif.done': 'Mark done',
    'notif.snooze': 'Snooze 10m',

    'time.now': 'now',
    'time.inMinutes': 'in {n} min',
    'time.inHours': 'in {n} h',
    'time.inDays': 'in {n} d',
    'time.agoMinutes': '{n} min ago',
    'time.agoHours': '{n} h ago',
    'time.agoDays': '{n} d ago',
    'time.overdueBy': '{dur} overdue',

    'a11y.close': 'Close',
    'a11y.dragHandle': 'Drag to reorder',
    'a11y.toggleDone': 'Toggle completion',
    'a11y.more': 'More options'
  };

  /* Motivational banners — rotated once per app launch (never repeating the last one). */
  var QUOTES = {
    ar: [
      'تعلّم من الأمس، وركّز على اليوم، وابدأ الآن.',
      'الإنجاز الصغير المتكرر يصنع نجاحًا كبيرًا.',
      'لا تنتظر اللحظة المثالية؛ ابدأ باللحظة الممكنة.',
      'خطوة واحدة اليوم تختصر طريق الغد.',
      'الأهم أولًا، والعاجل في موضعه.',
      'كل مهمة منجزة وعدٌ وفيتَ به لنفسك.',
      'النظام يغلب الحماس: استمر ولو قليلًا.',
      'ما تُنجزه اليوم راحةُ غدك.',
      'قليلٌ دائم خير من كثيرٍ منقطع.',
      'المهام الكبيرة تُؤكل لقمةً لقمة.',
      'وقتك أثمن من أن يُصرف في ما لا يهم.',
      'التركيز أن تقول «لا» لألف شيء جيد.',
      'ابدأ قبل أن تشعر بالاستعداد؛ الاستعداد يأتي بعد البدء.',
      'إنجاز اليوم بذرة طمأنينة الليل.',
      'لا تؤجل عملًا يجعل غدك أسهل.',
      'التنظيم نصف الإنجاز.',
      'أفضل وقت للإنجاز هو الآن.',
      'وضّح أولوياتك قبل أن تزحم يومك.',
      'المثابرة الهادئة تهزم الاندفاع المتقطع.',
      'كل يوم صفحة؛ فاكتب فيها ما يستحق.',
      'حين تتعب، نظّم وقتك ولا تنسحب.',
      'النجاح عادة يومية صغيرة تُكرَّر بصدق.'
    ],
    en: [
      'Learn from yesterday, focus on today, begin now.',
      'Small repeated wins build large success.',
      'Do not wait for the perfect moment; start with the possible one.',
      'One step today shortens tomorrow’s road.',
      'The important first, the urgent in its place.',
      'Every finished task is a promise kept to yourself.',
      'System beats motivation: keep going, even a little.',
      'What you finish today is tomorrow’s rest.',
      'A little, consistently, beats a lot, occasionally.',
      'Big tasks are eaten one bite at a time.',
      'Your time is too valuable for what does not matter.',
      'Focus is saying no to a thousand good things.',
      'Start before you feel ready; readiness follows action.',
      'Today’s completion is tonight’s peace of mind.',
      'Never postpone what makes tomorrow easier.',
      'Order is half of achievement.',
      'The best time to finish is now.',
      'Clarify priorities before you crowd your day.',
      'Quiet persistence beats sporadic intensity.',
      'Every day is a page; write what matters on it.',
      'When tired, organise your time — do not quit.',
      'Success is a small daily habit, repeated sincerely.'
    ]
  };

  var CATALOGS = { ar: AR, en: EN };
  var lang = 'ar';
  var missing = {};

  function setLang(l) {
    lang = (l === 'en') ? 'en' : 'ar';
    return lang;
  }
  function getLang() { return lang; }
  function isRtl() { return lang !== 'en'; }
  function dir() { return isRtl() ? 'rtl' : 'ltr'; }

  function t(key, vars) {
    var cat = CATALOGS[lang] || AR;
    var s = cat[key];
    if (s == null) {
      s = AR[key];
      if (s == null) {
        if (!missing[key] && typeof console !== 'undefined') {
          missing[key] = 1;
          console.warn('[i18n] missing key: ' + key);
        }
        return key;
      }
    }
    if (vars) {
      s = s.replace(/\{(\w+)\}/g, function (m, name) {
        return vars[name] == null ? m : String(vars[name]);
      });
    }
    return s;
  }

  function has(key) { return !!(CATALOGS[lang] && CATALOGS[lang][key]) || !!AR[key]; }
  function keys() { return Object.keys(AR); }
  function keyParity() {
    var a = Object.keys(AR), e = Object.keys(EN);
    var onlyAr = a.filter(function (k) { return EN[k] == null; });
    var onlyEn = e.filter(function (k) { return AR[k] == null; });
    return { ar: a.length, en: e.length, onlyAr: onlyAr, onlyEn: onlyEn };
  }

  // ------------------------------------------------------------ numbers & dates

  /** Western digits always (the app never renders Arabic-Indic numerals). */
  function n(v) { return String(v); }

  function fmtTime(ms) {
    var p = D.parts(ms);
    return U.pad2(p.H) + ':' + U.pad2(p.M);
  }

  function fmtDate(ms) {
    var p = D.parts(ms);
    return lang === 'ar'
      ? p.d + ' ' + MONTHS.ar[p.m - 1] + ' ' + p.y
      : MONTHS_SHORT.en[p.m - 1] + ' ' + p.d + ', ' + p.y;
  }

  function fmtDateShort(ms) {
    var p = D.parts(ms);
    return lang === 'ar'
      ? p.d + ' ' + MONTHS_SHORT.ar[p.m - 1]
      : MONTHS_SHORT.en[p.m - 1] + ' ' + p.d;
  }

  function fmtDow(ms) { return DOW[lang][D.parts(ms).iso]; }
  function fmtDowShort(ms) { return DOW_SHORT[lang][D.parts(ms).iso]; }
  function dowShortByIso(iso) { return DOW_SHORT[lang][iso]; }

  function fmtMonthYear(ms) {
    var p = D.parts(ms);
    return lang === 'ar' ? MONTHS.ar[p.m - 1] + ' ' + p.y : MONTHS.en[p.m - 1] + ' ' + p.y;
  }

  function fmtDateTime(ms) {
    return lang === 'ar'
      ? fmtDow(ms) + ' ' + fmtDate(ms) + '، ' + fmtTime(ms)
      : fmtDowShort(ms) + ', ' + fmtDate(ms) + ' · ' + fmtTime(ms);
  }

  function fmtDayLabel(ms) {
    return lang === 'ar' ? fmtDow(ms) + ' ' + D.parts(ms).d : fmtDowShort(ms) + ' ' + D.parts(ms).d;
  }

  /** "6 – 12 September 2026", handling month and year rollovers. */
  function fmtWeekRange(startMs, endMs) {
    var a = D.parts(startMs), b = D.parts(endMs);
    if (lang === 'ar') {
      if (a.y === b.y && a.m === b.m) return a.d + ' – ' + b.d + ' ' + MONTHS.ar[a.m - 1] + ' ' + a.y;
      if (a.y === b.y) return a.d + ' ' + MONTHS_SHORT.ar[a.m - 1] + ' – ' + b.d + ' ' + MONTHS_SHORT.ar[b.m - 1] + ' ' + a.y;
      return a.d + ' ' + MONTHS_SHORT.ar[a.m - 1] + ' ' + a.y + ' – ' + b.d + ' ' + MONTHS_SHORT.ar[b.m - 1] + ' ' + b.y;
    }
    if (a.y === b.y && a.m === b.m) return MONTHS_SHORT.en[a.m - 1] + ' ' + a.d + ' – ' + b.d + ', ' + a.y;
    if (a.y === b.y) return MONTHS_SHORT.en[a.m - 1] + ' ' + a.d + ' – ' + MONTHS_SHORT.en[b.m - 1] + ' ' + b.d + ', ' + a.y;
    return MONTHS_SHORT.en[a.m - 1] + ' ' + a.d + ', ' + a.y + ' – ' + MONTHS_SHORT.en[b.m - 1] + ' ' + b.d + ', ' + b.y;
  }

  /** Compact duration, Western digits: "5 د" / "5m", "3 س" / "3h", "2 ي" / "2d". */
  function fmtDur(ms) {
    var mins = Math.round(Math.abs(ms) / 60000);
    if (mins < 1) return lang === 'ar' ? 'الآن' : 'now';
    if (mins < 60) return lang === 'ar' ? mins + ' د' : mins + 'm';
    var hours = Math.round(mins / 60);
    if (hours < 24) return lang === 'ar' ? hours + ' س' : hours + 'h';
    var days = Math.round(hours / 24);
    return lang === 'ar' ? days + ' ي' : days + 'd';
  }

  /** Human relative label for a due timestamp. */
  function fmtDue(ms, now) {
    var n2 = now == null ? Date.now() : now;
    var diffDays = D.diffDays(n2, ms);
    var time = fmtTime(ms);
    if (diffDays === 0) return t('task.dueToday', { time: time });
    if (diffDays === 1) return t('task.dueTomorrow', { time: time });
    if (diffDays === -1) return (lang === 'ar' ? 'أمس ' : 'Yesterday ') + time;
    if (Math.abs(diffDays) <= 6) return fmtDowShort(ms) + ' · ' + time;
    return fmtDateShort(ms) + ' · ' + time;
  }

  function fmtOverdue(ms, now) {
    var n2 = now == null ? Date.now() : now;
    return t('time.overdueBy', { dur: fmtDur(n2 - ms) });
  }

  // ------------------------------------------------------------ plurals

  /**
   * Arabic plural categories (one/two/few/many). Other languages only distinguish
   * singular from plural, which is the `few` template with {n} interpolated.
   */
  function arCount(n, one, two, few, many) {
    if (lang !== 'ar') return n === 1 ? one : String(few).replace('{n}', n);
    if (n === 1) return one;
    if (n === 2) return two;
    if (n % 100 >= 3 && n % 100 <= 10) return few.replace('{n}', n);
    return many.replace('{n}', n);
  }

  function describeRecurrence(recStr, dayOfMonth) {
    var str = typeof recStr === 'string' ? recStr : ((recStr && recStr.s) || 'NONE');
    var bits = String(str).split(':');
    var kind = (bits[0] || 'NONE').toUpperCase();
    var iv = Math.max(1, parseInt(bits[1], 10) || 1);
    var dom = parseInt(bits[2], 10) || dayOfMonth || null;
    var out;
    if (kind === 'DAILY') {
      out = arCount(iv, t('repeat.desc.daily1'), t('repeat.desc.daily2'), t('repeat.desc.dailyN'), t('repeat.desc.dailyMany'));
    } else if (kind === 'MONTHLY') {
      out = arCount(iv, t('repeat.desc.monthly1'), t('repeat.desc.monthly2'), t('repeat.desc.monthlyN'), t('repeat.desc.monthlyMany'));
      if (dom) out += t('repeat.desc.dayOfMonth', { d: dom });
    } else if (kind === 'WEEKLY') {
      var maskI = parseInt(bits[2], 10) || 0;
      out = arCount(iv, t('repeat.desc.weekly1'), t('repeat.desc.weekly2'), t('repeat.desc.weeklyN'), t('repeat.desc.weeklyMany'));
      var order = [6, 7, 1, 2, 3, 4, 5];           // Saturday-first, like the week view
      var names = [];
      for (var oi = 0; oi < order.length; oi++) {
        if (maskI & (1 << (order[oi] - 1))) names.push(DOW_SHORT[lang][order[oi]]);
      }
      if (names.length) out += t('repeat.desc.weeklyDays', { days: names.join(lang === 'ar' ? '، ' : ', ') });
    } else {
      return '';
    }
    return out;
  }

  function describeCount(n) {
    if (lang === 'ar') {
      if (n === 1) return t('end.count1');
      if (n === 2) return t('end.count2');
      if (n % 100 >= 3 && n % 100 <= 10) return t('end.countN', { n: n });
      return t('end.countMany', { n: n });
    }
    return n === 1 ? t('end.count1') : t('end.countN', { n: n });
  }

  function pluralTasks(n) {
    if (lang === 'ar') {
      if (n === 0) return 'لا مهام';
      if (n === 1) return 'مهمة واحدة';
      if (n === 2) return 'مهمتان';
      if (n % 100 >= 3 && n % 100 <= 10) return n + ' مهام';
      return n + ' مهمة';
    }
    return n === 1 ? '1 task' : n + ' tasks';
  }

  function quadrantName(key) { return t('matrix.' + key + '.name'); }
  function quadrantSub(key) { return t('matrix.' + key + '.sub'); }

  return {
    MONTHS: MONTHS, MONTHS_SHORT: MONTHS_SHORT, DOW: DOW, DOW_SHORT: DOW_SHORT,
    CATALOGS: CATALOGS,
    setLang: setLang, getLang: getLang, isRtl: isRtl, dir: dir,
    t: t, has: has, keys: keys, keyParity: keyParity,
    n: n, fmtTime: fmtTime, fmtDate: fmtDate, fmtDateShort: fmtDateShort,
    fmtDow: fmtDow, fmtDowShort: fmtDowShort, dowShortByIso: dowShortByIso,
    fmtMonthYear: fmtMonthYear, fmtDateTime: fmtDateTime, fmtDayLabel: fmtDayLabel,
    fmtWeekRange: fmtWeekRange, fmtDur: fmtDur, fmtDue: fmtDue, fmtOverdue: fmtOverdue,
    describeRecurrence: describeRecurrence, describeCount: describeCount,
    pluralTasks: pluralTasks, quadrantName: quadrantName, quadrantSub: quadrantSub,
    arCount: arCount,
    QUOTES: QUOTES,
    quotes: function () { return QUOTES[lang] || QUOTES.ar; },
    /** Random quote, guaranteed different from `lastIndex`. */
    pickQuote: function (lastIndex) {
      var list = QUOTES[lang] || QUOTES.ar;
      if (list.length < 2) return { index: 0, text: list[0] || '' };
      var i = Math.floor(Math.random() * list.length);
      if (i === (lastIndex | 0)) i = (i + 1) % list.length;
      return { index: i, text: list[i] };
    }
  };
});
