class McDateTimePicker {
  static IMG_DIR = "/static/vendor/mc-datetime-picker/assets/blocks";

  static UNDERGROUND_TEXTURES = [
    { start: 0,  end: 2,  block: "sculk",              name: "遠古城市" },
    { start: 3,  end: 5,  block: "amethyst_block",     name: "紫水晶洞" },
    { start: 6,  end: 8,  block: "clay",               name: "蒼鬱洞窟" },
    { start: 9,  end: 11, block: "dripstone_block",    name: "鐘乳石洞" },
    { start: 12, end: 14, block: "copper_block",       name: "試煉密室" },
    { start: 15, end: 17, block: "oak_planks",         name: "廢棄礦坑" },
    { start: 18, end: 20, block: "mossy_stone_bricks", name: "終界祭壇" },
    { start: 21, end: 23, block: "sulfur",             name: "硫磺洞窟" }
  ];

  static ORE_WEIGHTS = [
    "coal", "coal", "coal",
    "iron", "iron",
    "copper", "copper",
    "gold",
    "lapis",
    "emerald",
    "diamond"
  ];

  constructor(options) {
    if (typeof options === "string") {
      options = { selector: options };
    }

    this.options = {
      selector: options.selector,
      defaultDate: options.defaultDate || null,
      enableTime: options.enableTime ?? true,
      time24hr: options.time24hr ?? true,
      minuteIncrement: options.minuteIncrement || 5,
      dateFormat: options.dateFormat || "Y-m-d H:i",
      altInput: options.altInput ?? true,
      altFormat: options.altFormat || "Y/m/d H:i",
      locale: options.locale || "zh_tw",
      allowInput: options.allowInput ?? true
    };

    if (!this.options.selector) {
      throw new Error("McDateTimePicker: selector is required.");
    }

    this.instance = this.createPicker();
  }

  static create(options) {
    return new McDateTimePicker(options);
  }

  createPicker() {
    return flatpickr(this.options.selector, {
      enableTime: this.options.enableTime,
      time_24hr: this.options.time24hr,
      minuteIncrement: this.options.minuteIncrement,
      dateFormat: this.options.dateFormat,
      altInput: this.options.altInput,
      altFormat: this.options.altFormat,
      locale: this.options.locale,
      defaultDate: this.options.defaultDate,
      allowInput: this.options.allowInput,

      onReady: (selectedDates, dateStr, instance) => {
        this.applyMcCalendar(instance);
        this.applyTimeTexture(instance);
        this.refreshAllDays(instance);
      },

      onOpen: (selectedDates, dateStr, instance) => {
        this.applyMcCalendar(instance);
        this.applyTimeTexture(instance);
        this.refreshAllDays(instance);
      },

      onChange: (selectedDates, dateStr, instance) => {
        this.applyMcCalendar(instance);
        this.applyTimeTexture(instance);
        this.refreshAllDays(instance);
      },

      onMonthChange: (selectedDates, dateStr, instance) => {
        setTimeout(() => this.refreshAllDays(instance), 0);
      },

      onYearChange: (selectedDates, dateStr, instance) => {
        setTimeout(() => this.refreshAllDays(instance), 0);
      },

      onDayCreate: (dObj, dStr, fp, dayElem) => {
        this.decorateDay(dayElem, fp);
      }
    });
  }

  getSelectedOrCurrentDate(instance) {
    return instance.selectedDates && instance.selectedDates[0]
      ? instance.selectedDates[0]
      : new Date();
  }

  getUndergroundTextureByHour(hour) {
    return this.constructor.UNDERGROUND_TEXTURES.find(
      item => hour >= item.start && hour <= item.end
    );
  }

  applyTimeTexture(instance) {
    const selected = this.getSelectedOrCurrentDate(instance);
    const texture = this.getUndergroundTextureByHour(selected.getHours());

    if (!texture) return;

    instance.calendarContainer.style.setProperty(
      "--time-bg-img",
      `url("${this.constructor.IMG_DIR}/${texture.block}.png")`
    );
  }

  isNightByPicker(instance) {
    const selected = this.getSelectedOrCurrentDate(instance);
    const hour = selected.getHours();

    return hour >= 18 || hour < 6;
  }

  isHoliday(date) {
    const day = date.getDay();
    return day === 0 || day === 6;
  }

  getSeed(date) {
    return (
      date.getFullYear() * 10000 +
      (date.getMonth() + 1) * 100 +
      date.getDate()
    );
  }

  shouldShowOre(date) {
    if (this.isHoliday(date)) return true;

    const seed = this.getSeed(date);
    return seed % 4 === 0;
  }

  getOreByDate(date) {
    if (this.isHoliday(date)) return "redstone";

    const seed = this.getSeed(date);
    return this.constructor.ORE_WEIGHTS[seed % this.constructor.ORE_WEIGHTS.length];
  }

  getOreImage(ore, instance) {
    if (this.isNightByPicker(instance)) {
      return `url("${this.constructor.IMG_DIR}/deepslate_${ore}_ore.png")`;
    }

    return `url("${this.constructor.IMG_DIR}/${ore}_ore.png")`;
  }

  decorateDay(dayElem, instance) {
    const date = dayElem.dateObj;
    if (!date) return;

    dayElem.classList.remove("mc-ore");
    dayElem.style.removeProperty("--ore-img");

    if (!this.shouldShowOre(date)) {
      return;
    }

    const ore = this.getOreByDate(date);

    dayElem.classList.add("mc-ore");
    dayElem.dataset.ore = ore;
    dayElem.style.setProperty("--ore-img", this.getOreImage(ore, instance));
  }

  refreshSelectedOre(instance) {
    instance.calendarContainer
      .querySelectorAll(".flatpickr-day.selected")
      .forEach(dayElem => {
        const date = dayElem.dateObj;
        if (!date) return;

        const ore = this.getOreByDate(date);

        dayElem.classList.add("mc-ore");
        dayElem.dataset.ore = ore;
        dayElem.style.setProperty("--ore-img", this.getOreImage(ore, instance));
      });
  }

  applyMcCalendar(instance) {
    const cal = instance.calendarContainer;

    cal.classList.add("mc-calendar");

    if (this.isNightByPicker(instance)) {
      cal.classList.add("mc-night");
      cal.classList.remove("mc-day");
    } else {
      cal.classList.add("mc-day");
      cal.classList.remove("mc-night");
    }
  }

  refreshAllDays(instance) {
    instance.calendarContainer
      .querySelectorAll(".flatpickr-day")
      .forEach(dayElem => {
        this.decorateDay(dayElem, instance);
      });

    this.refreshSelectedOre(instance);
  }
}

window.McDateTimePicker = McDateTimePicker;
