// 够用的测试跑子：分组、逐项打勾、失败汇总后退出码 1。不引入依赖。
import assert from 'node:assert/strict';

const tests = [];
let currentGroup = '';

export function group(name) {
  currentGroup = name;
}

export function test(name, fn) {
  tests.push({ group: currentGroup, name, fn });
}

export async function captureError(fn) {
  try {
    await fn();
  } catch (error) {
    return error;
  }
  throw new Error('预期抛错，但没有抛');
}

// 沙箱里造出来的对象原型属于另一个 realm，deepStrictEqual 会因此判不等。
// 统一走一遍 JSON 再比，比较的就是纯数据。
export function deepEqual(actual, expected, message) {
  assert.deepEqual(JSON.parse(JSON.stringify(actual ?? null)), expected, message);
}

export async function run(title) {
  let passed = 0;
  const failures = [];
  let printedGroup = '';

  for (const item of tests) {
    if (item.group !== printedGroup) {
      printedGroup = item.group;
      console.log(`\n  ${printedGroup}`);
    }
    try {
      await item.fn();
      passed += 1;
      console.log(`    ✓ ${item.name}`);
    } catch (error) {
      failures.push({ ...item, error });
      console.log(`    ✗ ${item.name}`);
    }
  }

  console.log('');
  if (failures.length) {
    for (const failure of failures) {
      console.log(`✗ ${failure.group} / ${failure.name}`);
      console.log(`  ${failure.error?.message || failure.error}`);
      if (failure.error?.stack) console.log(failure.error.stack.split('\n').slice(1, 4).join('\n'));
      console.log('');
    }
    console.log(`${passed} 通过，${failures.length} 失败`);
    process.exit(1);
  }

  console.log(`✓ ${title}全部通过（${passed} 项）`);
}
