export async function runWithConcurrency(tasks, limit){
  const results = []
  let index = 0
  const runners = new Array(Math.min(limit, tasks.length)).fill(0).map(async () => {
    while (index < tasks.length){
      const current = index++
      const task = tasks[current]
      results[current] = await task()
    }
  })
  await Promise.all(runners)
  return results
}
