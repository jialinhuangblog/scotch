---
title: "Drift"
slug: drift
brief: "實際狀態偏離宣告狀態。手動改、apply 失敗、設定過期。每一層都可能 drift。"
date: 2026-03-14
---

# Drift

宣告裡寫的狀態跟系統實際的狀態對不上，就是 drift。每一層都可能發生。

## 三層的 drift

**k8s**：有人 `kubectl edit` 改了 deployment 的 replica。YAML 檔寫 3，cluster 跑 5。下次 apply 會強制改回 3，但中間那段時間沒人知道。

**Terraform**：有人在 AWS Console 手動改了 security group rule。State file 不知道。`terraform plan` 會顯示一筆沒人從 code 改過的 diff。

**Helm**：`helm upgrade` 失敗到一半，部分 resource 更新了、部分沒有。Release 狀態是 `failed`，但 cluster 裡是半新半舊。

## 為什麼 drift 危險

系統實際的狀態跟大家以為的不一樣，決策就建立在錯的前提上，而且通常要到出問題才會發現。

## 防禦

1. **禁止手動改**：所有變更走 Git + CI/CD
2. **持續偵測**：ArgoCD drift detection、`terraform plan` 排程跑
3. **Auto-reconcile**：ArgoCD auto-sync 把 drift 自動修回 desired state
