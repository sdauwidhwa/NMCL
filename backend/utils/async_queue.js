export class async_queue {
  constructor() {
    this.limit = 10;
    this.active = 0;
    this.queue = [];
  }

  enqueue = (workload) => {
    return new Promise((resolve, reject) => {
      const task = () => {
        this.active++;
        workload().then(resolve).catch(reject).finally(() => {
          this.active--;
          if (this.queue.length > 0 && this.active < this.limit) {
            this.queue.shift()();
          }
        });
      };

      if (this.active < this.limit) {
        task();
      } else {
        this.queue.push(task);
      }
    });
  };
}

