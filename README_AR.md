# نظام الرؤية والتحميل المسبق — Sin1

استبدل في جذر المستودع: wings.js, wing-gpu-residency.js, index.html
أضف: wing-visibility.js و tests/wing-visibility.test.cjs، وحدّث tests/wing-gpu-residency.test.cjs

أو طبّق visibility.patch ثم أضف يدوياً في index.html بعد سطر wing-render-budget.js:
<script src="wing-visibility.js?v=20261109c"></script>
